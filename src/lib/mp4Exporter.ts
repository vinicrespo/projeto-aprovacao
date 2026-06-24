export interface Mp4ExportOptions {
  canvas: HTMLCanvasElement;
  video: HTMLVideoElement;
  videoFile: File;
  compressorThreshold: number;
  invertPhase: boolean;
  renderNow: () => void;
  syncGPU: () => void;
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

  pauseLoop();

  // CRITICAL: disable loop so video.onended fires and RVFC timestamps stay monotonic
  const wasLoop = video.loop;
  video.loop = false;

  try {
    const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");

    const width  = video.videoWidth  || 1280;
    const height = video.videoHeight || 720;
    const sampleRate = 44100;

    onProgress(0.02);

    // ── Audio offline processing ───────────────────────────────────────────
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

    // Encode audio
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

    // ── Video: play from start, capture every frame via RVFC ──────────────
    const videoEncoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => console.error("VideoEncoder:", e),
    });
    videoEncoder.configure({
      codec: "avc1.4d001f",
      width, height,
      bitrate: 8_000_000,
      framerate: 30,
      hardwareAcceleration: "no-preference",
      avc: { format: "avc" },
    });

    const duration = video.duration;

    // Seek to start
    await new Promise<void>((res) => {
      if (video.currentTime === 0) { res(); return; }
      const h = () => { video.removeEventListener("seeked", h); res(); };
      video.addEventListener("seeked", h);
      video.currentTime = 0;
    });

    video.play().catch(() => {});

    let framesEncoded = 0;
    let lastTsUs = -1;

    await new Promise<void>((resolve, reject) => {
      let finished = false;

      const done = () => {
        if (finished) return;
        finished = true;
        video.pause();
        resolve();
      };

      // Fallback in case video stalls
      const safetyTimer = setTimeout(done, (duration + 15) * 1000);

      video.onended = () => { clearTimeout(safetyTimer); done(); };

      const captureFrame = (
        _now: DOMHighResTimeStamp,
        metadata: { mediaTime: number }
      ) => {
        if (cancelRef.cancelled || finished) { clearTimeout(safetyTimer); done(); return; }

        try {
          const tsUs = Math.round(metadata.mediaTime * 1_000_000);

          if (tsUs > lastTsUs) {
            renderNow();
            syncGPU();

            const vf = new VideoFrame(canvas, { timestamp: tsUs });
            videoEncoder.encode(vf, { keyFrame: framesEncoded % 60 === 0 });
            vf.close();
            framesEncoded++;
            lastTsUs = tsUs;

            onProgress(0.18 + Math.min(metadata.mediaTime / duration, 1) * 0.79);
          }

          // Only video.onended stops the loop — never rely on duration estimate
          video.requestVideoFrameCallback(captureFrame);
        } catch (e) {
          clearTimeout(safetyTimer);
          reject(e);
        }
      };

      video.requestVideoFrameCallback(captureFrame);
    });

    if (cancelRef.cancelled) { videoEncoder.close(); return null; }

    await videoEncoder.flush();
    videoEncoder.close();

    muxer.finalize();
    onProgress(1);

    return new Blob([target.buffer], { type: "video/mp4" });

  } finally {
    video.onended = null;
    video.loop = wasLoop;
    video.currentTime = 0;
    video.play().catch(() => {});
    resumeLoop();
  }
}
