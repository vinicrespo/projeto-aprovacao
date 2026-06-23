/**
 * Exports the processed video as a proper H.264/AAC MP4 using WebCodecs API.
 * Falls back to a WebM blob if WebCodecs is unavailable (Firefox).
 *
 * Audio is processed offline (OfflineAudioContext) — no real-time wait needed.
 * Video frames are captured via requestVideoFrameCallback during playback.
 */

export interface Mp4ExportOptions {
  canvas: HTMLCanvasElement;
  video: HTMLVideoElement;
  videoFile: File;
  compressorThreshold: number;
  invertPhase: boolean;
  hashSeed: number;
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
  const arrayBuffer = await file.arrayBuffer();
  const tempCtx = new AudioContext();
  let audioBuffer: AudioBuffer;
  try {
    audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
  } finally {
    await tempCtx.close();
  }

  const channels = audioBuffer.numberOfChannels;
  const length = audioBuffer.length;
  const sampleRate = audioBuffer.sampleRate;

  const offlineCtx = new OfflineAudioContext(Math.min(channels, 2), length, sampleRate);

  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;

  const compressor = offlineCtx.createDynamicsCompressor();
  compressor.threshold.value = compressorThreshold;
  compressor.knee.value = 6;
  compressor.ratio.value = 4;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;

  const splitter = offlineCtx.createChannelSplitter(2);
  const merger = offlineCtx.createChannelMerger(2);
  const gainL = offlineCtx.createGain();
  const gainR = offlineCtx.createGain();
  gainL.gain.value = 1;
  gainR.gain.value = invertPhase ? -1 : 1;

  source.connect(compressor);
  compressor.connect(splitter);
  splitter.connect(gainL, 0);
  splitter.connect(gainR, 1);
  gainL.connect(merger, 0, 0);
  gainR.connect(merger, 0, 1);
  merger.connect(offlineCtx.destination);
  source.start();

  return offlineCtx.startRendering();
}

export async function exportMp4(options: Mp4ExportOptions): Promise<Blob | null> {
  const { canvas, video, videoFile, compressorThreshold, invertPhase, hashSeed, onProgress, cancelRef } = options;

  if (!webCodecsAvailable()) {
    // Fallback: return null so caller can show a message
    return null;
  }

  const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");

  const width = video.videoWidth || 1280;
  const height = video.videoHeight || 720;
  const sampleRate = 44100;

  onProgress(0.02);

  // --- Audio (offline, fast) ---
  const renderedAudio = await processAudioOffline(videoFile, compressorThreshold, invertPhase);
  if (cancelRef.cancelled) return null;

  onProgress(0.15);

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

  // Feed audio in 1024-frame chunks
  const CHUNK = 1024;
  const totalSamples = renderedAudio.length;
  const ch0 = renderedAudio.getChannelData(0);
  const ch1 = renderedAudio.numberOfChannels > 1
    ? renderedAudio.getChannelData(1)
    : renderedAudio.getChannelData(0);

  for (let i = 0; i < totalSamples; i += CHUNK) {
    if (cancelRef.cancelled) { audioEncoder.close(); return null; }
    const end = Math.min(i + CHUNK, totalSamples);
    const frames = end - i;
    const planar = new Float32Array(frames * 2);
    planar.set(ch0.slice(i, end), 0);
    planar.set(ch1.slice(i, end), frames);
    const audioData = new AudioData({
      format: "f32-planar",
      sampleRate,
      numberOfChannels: 2,
      numberOfFrames: frames,
      timestamp: Math.round((i / sampleRate) * 1_000_000),
      data: planar,
    });
    audioEncoder.encode(audioData);
    audioData.close();
  }
  await audioEncoder.flush();
  audioEncoder.close();

  onProgress(0.25);
  if (cancelRef.cancelled) return null;

  // --- Video (realtime via requestVideoFrameCallback) ---
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error("VideoEncoder:", e),
  });

  const avcCodec = "avc1.4d001f"; // H.264 Main Profile Level 3.1
  videoEncoder.configure({
    codec: avcCodec,
    width,
    height,
    bitrate: 8_000_000,
    framerate: 30,
    hardwareAcceleration: "prefer-hardware",
    avc: { format: "avc" },
  });

  let frameIndex = 0;
  const duration = video.duration;

  await new Promise<void>((resolve, reject) => {
    if (cancelRef.cancelled) { resolve(); return; }

    const captureFrame = (_now: number, meta: VideoFrameCallbackMetadata) => {
      if (cancelRef.cancelled) { resolve(); return; }

      // Two RAF ticks so WebGL has definitely uploaded this video frame
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const timestamp = Math.round(meta.mediaTime * 1_000_000);
          try {
            const vf = new VideoFrame(canvas, { timestamp });
            videoEncoder.encode(vf, { keyFrame: frameIndex % 60 === 0 });
            vf.close();
          } catch (e) {
            console.warn("VideoFrame capture failed:", e);
          }
          frameIndex++;
          const videoProgress = Math.min(meta.mediaTime / duration, 1);
          onProgress(0.25 + videoProgress * 0.75);

          if (!video.ended && !cancelRef.cancelled) {
            video.requestVideoFrameCallback(captureFrame);
          } else {
            resolve();
          }
        });
      });
    };

    video.requestVideoFrameCallback(captureFrame);
    video.currentTime = 0;
    video.play().catch(reject);
    video.onended = () => resolve();

    // Safety timeout
    setTimeout(resolve, duration * 1000 + 5000);
  });

  if (cancelRef.cancelled) { videoEncoder.close(); return null; }

  await videoEncoder.flush();
  videoEncoder.close();
  muxer.finalize();

  onProgress(1);

  const { buffer } = target;
  return new Blob([buffer], { type: "video/mp4" });
}
