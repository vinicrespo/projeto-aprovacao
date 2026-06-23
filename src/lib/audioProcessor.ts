export interface AudioProcessorOptions {
  invertPhase?: boolean;
  lowPassHz?: number;
  monitorVolume?: number; // 0–1, default 1 (audível no preview)
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
  private monitorGain: GainNode;

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

    // Monitor gain: routes processed audio to speakers for preview
    this.monitorGain = this.ctx.createGain();
    this.monitorGain.gain.value = options.monitorVolume ?? 1;
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

    // merger → lowPass → destination (export stream) + monitorGain → speakers
    this.merger.connect(this.lowPass);
    this.lowPass.connect(this.destination);
    this.lowPass.connect(this.monitorGain);
    this.monitorGain.connect(this.ctx.destination);

    if (this.ctx.state === "suspended") {
      this.ctx.resume();
    }

    return this.destination.stream;
  }

  setPhaseInvert(enabled: boolean) {
    this.phaseInverter.gain.value = enabled ? -1 : 1;
  }

  setMonitorVolume(v: number) {
    this.monitorGain.gain.value = Math.max(0, Math.min(1, v));
  }

  setMuted(muted: boolean) {
    this.monitorGain.gain.value = muted ? 0 : 1;
  }

  setLowPassFrequency(hz: number) {
    this.lowPass.frequency.value = hz;
  }

  /** threshold: -60 (máxima compressão) a 0 dB (sem efeito) */
  setCompressorThreshold(db: number) {
    this.compressor.threshold.value = Math.max(-60, Math.min(0, db));
  }

  /** ratio: 1 (sem compressão) a 20 (limitador forte) */
  setCompressorRatio(ratio: number) {
    this.compressor.ratio.value = Math.max(1, Math.min(20, ratio));
  }

  getAudioContext(): AudioContext {
    return this.ctx;
  }

  destroy() {
    this.source?.disconnect();
    this.ctx.close();
  }
}
