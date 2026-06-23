export interface Mp4ExportOptions {
  canvas: HTMLCanvasElement;
  video: HTMLVideoElement;
  videoFile: File;
  compressorThreshold: number;
  invertPhase: boolean;
  renderNow: () => void;       // WebGL render-on-demand from PreviewCanvas
  pauseLoop: () => void;       // pause preview RAF during export
  resumeLoop: () => void;      // resume preview RAF after export
  onProgress: (ratio: number) => void;
  cancelRef: { cancelled: boolean };
}

function webCodecsAvailable(): boolean {
  return (
    typeof VideoEncoder !== "undefined" &&
    typeof AudioEncoder !== "undefined" &&
    typeof VideoFrame !== "undefined" &&
    typeof AudioData !== "undefined"
  );
}

async function processAudioOffline(
  file: File,
  compressorThreshold: number,
  invertPhase: boolean
): Promise<AudioBuffer> {
  const buf = await file.arrayBuffer();
  const tempCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await tempCtx.decodeAudioData(buf);
  } finally {
    await tempCtx.close();
  }

  const ch = Math.min(decoded.numberOfChannels, 2);
  const offCtx = new OfflineAudioContext(ch, decoded.length, decoded.sampleRate);
  const src = offCtx.createBufferSource();
  src.buffer = decoded;

  const comp = offCtx.createDynamicsCompressor();
  comp.threshold.value = compressorThreshold;
  comp.knee.value = 6;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;

  const split = offCtx.createChannelSplitter(2);
  const merge = offCtx.createChannelMerger(2);
  const gL = offCtx.createGain();
  const gR = offCtx.createGain();
  gL.gain.value = 1;
  gR.gain.value = invertPhase ? -1 : 1;

  src.connect(comp);
  comp.connect(split);
  split.connect(gL, 0); gL.connect(merge, 0, 0);
  split.connect(gR, 1); gR.connect(merge, 0, 1);
  merge.connect(offCtx.destination);
  src.start();

  return offCtx.startRendering();
}

export async function exportMp4(opts: Mp4ExportOptions): Promise<Blob | null> {
  const { canvas, video, videoFile, compressorThreshold, invertPhase,
          renderNow, pauseLoop, resumeLoop, onProgress, cancelRef } = opts;

  if (!webCodecsAvailable()) return null;

  // Pause the preview RAF so it doesn't interfere with our frame captures
  pauseLoop();

  try {
    const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");

    const width = video.videoWidth || 1280;
    const height = video.videoHeight || 720;
    const sampleRate = 44100;

    onProgress(0.02);

    // --- Audio (offline, fast) ---
    const renderedAudio = await processAudioOffline(videoFile, compressorThreshold, invertPhase);
    if (cancelRef.cancelled) return null;
    onProgress(0.12);

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
      target,
      video: { codec: "avc", width, height },
      audio: { codec: "aac", numberOfChannels: 2, sampleRate },
      firstTimestampBehavior: "offset",
      fastStart: "in-memory",
    });

    // AudioEncoder
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => console.error("AudioEncoder:", e),
    });
    audioEncoder.configure({ codec: "mp4a.40.2", sampleRate, numberOfChannels: 2, bitrate: 192_000 });

    const CHUNK = 1024;
    const total = renderedAudio.length;
    const ch0 = renderedAudio.getChannelData(0);
    const ch1 = renderedAudio.numberOfChannels > 1 ? renderedAudio.getChannelData(1) : ch0;

    for (let i = 0; i < total; i += CHUNK) {
      if (cancelRef.cancelled) { audioEncoder.close(); return null; }
      const end = Math.min(i + CHUNK, total);
      const frames = end - i;
      const planar = new Float32Array(frames * 2);
      planar.set(ch0.subarray(i, end), 0);
      planar.set(ch1.subarray(i, end), frames);
      const ad = new AudioData({
        format: "f32-planar",
        sampleRate,
        numberOfChannels: 2,
        numberOfFrames: frames,
        timestamp: Math.round((i / sampleRate) * 1_000_000),
        data: planar,
      });
      audioEncoder.encode(ad);
      ad.close();
    }
    await audioEncoder.flush();
    audioEncoder.close();

    onProgress(0.2);
    if (cancelRef.cancelled) return null;

    // --- Video (requestVideoFrameCallback + explicit WebGL render) ---
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => console.error("VideoEncoder:", e),
    });
    videoEncoder.configure({
      codec: "avc1.4d001f",
      width, height,
      bitrate: 8_000_000,
      framerate: 30,
      hardwareAcceleration: "prefer-hardware",
      avc: { format: "avc" },
    });

    const duration = video.duration;
    let frameIndex = 0;

    // Disable loop so video.onended fires naturally
    video.loop = false;
    video.currentTime = 0;

    await new Promise<void>((resolve) => {
      if (cancelRef.cancelled) { resolve(); return; }

      const onEnded = () => { cleanup(); resolve(); };
      const cleanup = () => {
        video.removeEventListener("ended", onEnded);
      };
      video.addEventListener("ended", onEnded, { once: true });

      // Safety: if ended never fires (e.g. very short clip), bail after duration + 4s
      const safety = setTimeout(() => { cleanup(); resolve(); }, duration * 1000 + 4000);
      // Keep reference so we can clear it
      video.addEventListener("ended", () => clearTimeout(safety), { once: true });

      const captureFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
        if (cancelRef.cancelled) { resolve(); return; }

        // Tell WebGL to render this exact video frame right now
        renderNow();

        // One microtask tick so WebGL pipeline flushes before we capture
        requestAnimationFrame(() => {
          const tsUs = Math.round(meta.mediaTime * 1_000_000);
          try {
            const vf = new VideoFrame(canvas, { timestamp: tsUs });
            videoEncoder.encode(vf, { keyFrame: frameIndex % 60 === 0 });
            vf.close();
          } catch (e) {
            console.warn("VideoFrame capture error:", e);
          }
          frameIndex++;
          onProgress(0.2 + Math.min(meta.mediaTime / duration, 1) * 0.8);

          if (!video.ended && !cancelRef.cancelled) {
            video.requestVideoFrameCallback(captureFrame);
          }
        });
      };

      video.requestVideoFrameCallback(captureFrame);
      video.play().catch(() => resolve());
    });

    if (cancelRef.cancelled) { videoEncoder.close(); return null; }

    await videoEncoder.flush();
    videoEncoder.close();
    muxer.finalize();

    onProgress(1);
    return new Blob([target.buffer], { type: "video/mp4" });

  } finally {
    // Always restore preview: re-enable loop and resume RAF
    video.loop = true;
    video.play().catch(() => {});
    resumeLoop();
  }
}
