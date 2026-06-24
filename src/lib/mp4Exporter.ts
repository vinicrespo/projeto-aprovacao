export interface Mp4ExportOptions {
  canvas: HTMLCanvasElement;
  video: HTMLVideoElement;
  videoFile: File;
  compressorThreshold: number;
  invertPhase: boolean;
  renderNow: () => void;
  syncGPU: () => void;     // gl.finish() — blocks until GPU done
  pauseLoop: () => void;
  resumeLoop: () => void;
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
  const {
    canvas, video, videoFile,
    compressorThreshold, invertPhase,
    renderNow, syncGPU, pauseLoop, resumeLoop,
    onProgress, cancelRef,
  } = opts;

  if (!webCodecsAvailable()) return null;

  // Stop preview RAF — we own the canvas during export
  pauseLoop();

  try {
    const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");

    const width  = video.videoWidth  || 1280;
    const height = video.videoHeight || 720;
    const sampleRate = 44100;

    onProgress(0.02);

    // ── Audio (processed offline — fast) ──────────────────────────────────
    const renderedAudio = await processAudioOffline(
      videoFile, compressorThreshold, invertPhase
    );
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
    audioEncoder.configure({
      codec: "mp4a.40.2",
      sampleRate,
      numberOfChannels: 2,
      bitrate: 192_000,
    });

    const CHUNK = 1024;
    const totalSamples = renderedAudio.length;
    const ch0 = renderedAudio.getChannelData(0);
    const ch1 = renderedAudio.numberOfChannels > 1
      ? renderedAudio.getChannelData(1)
      : ch0;

    for (let i = 0; i < totalSamples; i += CHUNK) {
      if (cancelRef.cancelled) { audioEncoder.close(); return null; }
      const end    = Math.min(i + CHUNK, totalSamples);
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

    onProgress(0.18);
    if (cancelRef.cancelled) return null;

    // ── Video (frame-by-frame seek — reliable, every frame guaranteed) ────
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => console.error("VideoEncoder:", e),
    });
    videoEncoder.configure({
      codec: "avc1.4d001f",           // H.264 Main Profile Level 3.1
      width, height,
      bitrate: 8_000_000,
      framerate: 30,
      hardwareAcceleration: "no-preference", // software encoder = reliable
      avc: { format: "avc" },                // AVCC format for MP4 container
    });

    const duration = video.duration;

    // Seek to beginning and play — RVFC gives us exact frame timestamps
    video.currentTime = 0;
    await new Promise<void>((res) => {
      const h = () => { video.removeEventListener("seeked", h); res(); };
      video.addEventListener("seeked", h);
    });
    video.play().catch(() => {});

    let framesEncoded = 0;

    await new Promise<void>((resolve, reject) => {
      let finished = false;
      const done = () => { if (!finished) { finished = true; resolve(); } };

      // Safety: if video ends or stalls, finalize after duration + buffer
      const safetyTimer = setTimeout(done, (duration + 10) * 1000);

      const captureFrame = (
        _: DOMHighResTimeStamp,
        metadata: { mediaTime: number; presentedFrames: number }
      ) => {
        if (cancelRef.cancelled || finished) { done(); return; }

        try {
          // Use mediaTime for exact, monotonic timestamps (microseconds)
          const tsUs = Math.round(metadata.mediaTime * 1_000_000);

          // renderNow() uploads current video texture and runs WebGL shaders
          renderNow();

          // gl.finish() blocks JS until GPU finishes — canvas is guaranteed ready
          syncGPU();

          const vf = new VideoFrame(canvas, { timestamp: tsUs });
          videoEncoder.encode(vf, { keyFrame: framesEncoded % 60 === 0 });
          vf.close();
          framesEncoded++;

          const progress = Math.min(metadata.mediaTime / duration, 1);
          onProgress(0.18 + progress * 0.79);

          if (metadata.mediaTime >= duration - 0.05) {
            clearTimeout(safetyTimer);
            done();
          } else {
            video.requestVideoFrameCallback(captureFrame);
          }
        } catch (e) {
          clearTimeout(safetyTimer);
          reject(e);
        }
      };

      video.requestVideoFrameCallback(captureFrame);

      video.onended = () => { clearTimeout(safetyTimer); done(); };
    });

    if (cancelRef.cancelled) { videoEncoder.close(); return null; }

    await videoEncoder.flush();
    videoEncoder.close();

    muxer.finalize();
    onProgress(1);

    return new Blob([target.buffer], { type: "video/mp4" });

  } finally {
    video.onended = null;
    video.loop = true;
    video.currentTime = 0;
    video.play().catch(() => {});
    resumeLoop();
  }
}
