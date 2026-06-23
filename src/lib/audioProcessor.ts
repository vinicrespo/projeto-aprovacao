export interface AudioProcessorOptions {
  invertPhase?: boolean;
  lowPassHz?: number;
}

export class AudioProcessor {
  private ctx: AudioContext;
  private source: MediaElementAudioSourceNode | null = null;
  private compressor: DynamicsCompressorNode;
  private phaseInverter: GainNode;
  private invertGain: GainNode;
  private merger: ChannelMergerNode;
  private splitter: ChannelSplitterNode;
  private lowPass: BiquadFilterNode;
  private destination: MediaStreamAudioDestinationNode;

  constructor(options: AudioProcessorOptions = {}) {
    this.ctx = new AudioContext();

    // Dynamic compressor: tames peaks, normalises loudness
    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 6;
    this.compressor.ratio.value = 4;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;

    // Phase inversion via gain -1 on one channel then re-merge
    this.splitter = this.ctx.createChannelSplitter(2);
    this.phaseInverter = this.ctx.createGain();
    this.phaseInverter.gain.value = options.invertPhase ? -1 : 1;
    this.invertGain = this.ctx.createGain();
    this.invertGain.gain.value = 1;
    this.merger = this.ctx.createChannelMerger(2);

    // Low-pass: emulate mono speaker acoustics
    this.lowPass = this.ctx.createBiquadFilter();
    this.lowPass.type = "lowpass";
    this.lowPass.frequency.value = options.lowPassHz ?? 18000;
    this.lowPass.Q.value = 0.7;

    this.destination = this.ctx.createMediaStreamDestination();
  }

  connect(video: HTMLMediaElement): MediaStream {
    if (this.source) {
      this.source.disconnect();
    }
    this.source = this.ctx.createMediaElementSource(video);

    // source → compressor → splitter
    this.source.connect(this.compressor);
    this.compressor.connect(this.splitter);

    // L channel → regular gain → merger L
    this.splitter.connect(this.invertGain, 0);
    this.invertGain.connect(this.merger, 0, 0);

    // R channel → phase inverter → merger R
    this.splitter.connect(this.phaseInverter, 1);
    this.phaseInverter.connect(this.merger, 0, 1);

    // merger → lowPass → destination
    this.merger.connect(this.lowPass);
    this.lowPass.connect(this.destination);

    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }

    return this.destination.stream;
  }

  setPhaseInvert(enabled: boolean) {
    this.phaseInverter.gain.value = enabled ? -1 : 1;
  }

  setLowPassFrequency(hz: number) {
    this.lowPass.frequency.value = hz;
  }

  getAudioContext(): AudioContext {
    return this.ctx;
  }

  destroy() {
    this.source?.disconnect();
    this.ctx.close();
  }
}
