import { createProgram, setupFullscreenQuad, createTexture, uploadVideoTexture } from "@/lib/shaderLoader";
import { cleanMp4Metadata } from "@/lib/mp4Metadata";

export interface CreativeOptions {
  coverFile: File;
  videoFile: File;
  onProgress: (ratio: number, phase: string) => void;
  cancelRef: { cancelled: boolean };
  introSeconds?: number;  // override for testing; defaults to INTRO_SECONDS
  outroSeconds?: number;  // override for testing; defaults to OUTRO_SECONDS
}

// ── Fixed pipeline constants (matches reference SaaS behaviour) ──────────────
const INTRO_SECONDS = 2;      // cover shown briefly at the start
const OUTRO_SECONDS = 300;    // cover held for 5 minutes at the end
const VIDEO_FPS     = 30;
const COVER_FPS     = 10;     // static cover — lower fps keeps encode fast & small

// Baked-in effect preset applied to the video portion
const PRESET = {
  contrast:   0.35,
  chromatic:  0.30,
  noise:      0.25,
  pixelation: 0.07,   // subtle
  flash:      0.6,
};

const FRAG_GLSL_PATH = "/standardization_frag.glsl";

// Video encoding is required; audio encoding is optional (falls back to silent)
function videoCodecsAvailable(): boolean {
  return (
    typeof VideoEncoder !== "undefined" &&
    typeof VideoFrame !== "undefined" &&
    typeof EncodedVideoChunk !== "undefined"
  );
}
function audioCodecsAvailable(): boolean {
  return typeof AudioEncoder !== "undefined" && typeof AudioData !== "undefined";
}

// Probe H.264 codec strings and return the first the browser can encode.
const H264_CANDIDATES = [
  "avc1.640028", // High   L4.0
  "avc1.4d0028", // Main   L4.0
  "avc1.42e028", // Baseline L4.0
  "avc1.640020", // High   L3.2
  "avc1.4d001f", // Main   L3.1
  "avc1.42001f", // Baseline L3.1
];

async function pickVideoCodec(
  width: number, height: number, framerate: number, bitrate: number
): Promise<string | null> {
  for (const codec of H264_CANDIDATES) {
    try {
      for (const hw of ["no-preference", "prefer-software", "prefer-hardware"] as const) {
        const res = await VideoEncoder.isConfigSupported({
          codec, width, height, bitrate, framerate, hardwareAcceleration: hw,
        });
        if (res.supported) return codec;
      }
    } catch { /* try next */ }
  }
  return null;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = URL.createObjectURL(file);
  });
}

function loadVideo(file: File): Promise<HTMLVideoElement> {
  return new Promise((res, rej) => {
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.crossOrigin = "anonymous";
    v.onloadedmetadata = () => res(v);
    v.onerror = rej;
    v.src = URL.createObjectURL(file);
  });
}

// Draw cover into a 2D canvas at output dims using "cover" fit (fills, crops overflow)
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number) {
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

// Process the video's audio (compressor + hash phase) — returns buffer of video length
async function processAudio(file: File): Promise<AudioBuffer | null> {
  let decoded: AudioBuffer;
  try {
    const buf = await file.arrayBuffer();
    const tmp = new AudioContext();
    try { decoded = await tmp.decodeAudioData(buf); }
    finally { await tmp.close(); }
  } catch {
    return null; // video may have no audio track
  }

  const ch = Math.min(decoded.numberOfChannels, 2);
  const off = new OfflineAudioContext(2, decoded.length, decoded.sampleRate);
  const src = off.createBufferSource();
  src.buffer = decoded;

  const comp = off.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 6;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.25;

  if (ch === 1) {
    src.connect(comp);
    comp.connect(off.destination);
  } else {
    src.connect(comp);
    comp.connect(off.destination);
  }
  src.start();
  return off.startRendering();
}

export async function processCreative(opts: CreativeOptions): Promise<Blob | null> {
  const { coverFile, videoFile, onProgress, cancelRef } = opts;
  const introSec = opts.introSeconds ?? INTRO_SECONDS;
  const outroSec = opts.outroSeconds ?? OUTRO_SECONDS;

  // Require a secure context — WebCodecs is disabled on http://
  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new Error("Acesse o site por HTTPS para processar (WebCodecs exige conexão segura).");
  }
  if (!videoCodecsAvailable()) {
    throw new Error("Seu navegador não suporta WebCodecs de vídeo. Use o Chrome ou Edge atualizado no desktop.");
  }

  const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");

  onProgress(0.01, "Carregando arquivos…");
  const [coverImg, video] = await Promise.all([loadImage(coverFile), loadVideo(videoFile)]);

  // Output dimensions — force even for H.264
  const w = (video.videoWidth  || 720)  & ~1;
  const h = (video.videoHeight || 1280) & ~1;
  const videoDuration = video.duration;
  const totalDuration = introSec + videoDuration + outroSec;

  // ── Cover 2D canvas (source for intro + outro frames) ──────────────────────
  const coverCanvas = document.createElement("canvas");
  coverCanvas.width = w; coverCanvas.height = h;
  const coverCtx = coverCanvas.getContext("2d")!;
  drawCover(coverCtx, coverImg, w, h);

  // ── WebGL canvas (source for effect-processed video frames) ────────────────
  const glCanvas = document.createElement("canvas");
  glCanvas.width = w; glCanvas.height = h;
  const gl = glCanvas.getContext("webgl2");
  if (!gl) {
    throw new Error("Não foi possível iniciar o WebGL2 (aceleração gráfica pode estar desativada no Chrome).");
  }

  const fragSrc = await fetch(FRAG_GLSL_PATH).then((r) => r.text());
  const program = createProgram(gl, fragSrc);
  const vao = setupFullscreenQuad(gl, program);
  const tex = createTexture(gl);
  gl.viewport(0, 0, w, h);
  gl.useProgram(program);

  const hashSeed = Math.random();
  const loc = (n: string) => gl.getUniformLocation(program, n);
  const uContrast   = loc("u_contrast_curve");
  const uChromatic  = loc("u_chromatic_offset");
  const uMotion     = loc("u_motion_blur_weight");
  const uNoiseDens  = loc("u_noise_density");
  const uNoiseOn    = loc("u_noise_enabled");
  const uFlipV      = loc("u_flip_v");
  const uFlipH      = loc("u_flip_h");
  const uHash       = loc("u_hash_seed");
  const uPixel      = loc("u_crackle_intensity");
  const uFlash      = loc("u_flash");
  const uTime       = loc("u_time");
  const uTexture    = loc("u_texture");
  const uPrev       = loc("u_prev_texture");

  const renderVideoFrame = (mediaTime: number) => {
    uploadVideoTexture(gl, tex, video);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniform1f(uContrast,  PRESET.contrast);
    gl.uniform1f(uChromatic, PRESET.chromatic);
    gl.uniform1f(uMotion,    0);
    gl.uniform1f(uNoiseDens, PRESET.noise);
    gl.uniform1f(uNoiseOn,   1);
    gl.uniform1f(uFlipV,     0);
    gl.uniform1f(uFlipH,     0);
    gl.uniform1f(uHash,      hashSeed);
    gl.uniform1f(uPixel,     PRESET.pixelation);
    gl.uniform1f(uFlash,     PRESET.flash);
    gl.uniform1f(uTime,      mediaTime);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(uTexture, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex); // reuse as prev (motion weight = 0 → unused)
    gl.uniform1i(uPrev, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.finish(); // ensure GPU done before VideoFrame reads the canvas
  };

  // ── Muxer + encoders ───────────────────────────────────────────────────────
  const VIDEO_BITRATE = 3_500_000;

  // Detect a supported H.264 codec string for these dimensions
  const codec = await pickVideoCodec(w, h, VIDEO_FPS, VIDEO_BITRATE);
  if (!codec) {
    throw new Error("Nenhum codec H.264 compatível encontrado neste navegador. Use o Chrome atualizado no desktop.");
  }

  const target = new ArrayBufferTarget();

  // Audio is optional — only if both the WebCodecs audio API and a decodable
  // audio track exist. Otherwise the creative is exported silent (no failure).
  const audioBuf = audioCodecsAvailable() ? await processAudio(videoFile) : null;
  const hasAudio = !!audioBuf;
  const audioSampleRate = audioBuf?.sampleRate ?? 44100;

  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: w, height: h },
    ...(hasAudio ? { audio: { codec: "aac", numberOfChannels: 2, sampleRate: audioSampleRate } } : {}),
    firstTimestampBehavior: "offset",
    fastStart: "in-memory",
  });

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error("VideoEncoder:", e),
  });
  videoEncoder.configure({
    codec,
    width: w, height: h,
    bitrate: VIDEO_BITRATE,
    framerate: VIDEO_FPS,
    hardwareAcceleration: "no-preference",
    avc: { format: "avc" },
  });

  let frameIndex = 0;
  const encodeCanvasFrame = async (
    source: HTMLCanvasElement,
    tsSeconds: number,
    keyFrame: boolean
  ) => {
    const vf = new VideoFrame(source, { timestamp: Math.round(tsSeconds * 1_000_000) });
    videoEncoder.encode(vf, { keyFrame });
    vf.close();
    frameIndex++;
    if (videoEncoder.encodeQueueSize > 8) {
      await new Promise<void>((r) => {
        const check = () => (videoEncoder.encodeQueueSize <= 4 ? r() : setTimeout(check, 8));
        check();
      });
    }
  };

  // ── Phase 1: intro cover ────────────────────────────────────────────────────
  onProgress(0.03, "Montando capa de abertura…");
  const introFrames = Math.round(introSec * COVER_FPS);
  for (let i = 0; i < introFrames; i++) {
    if (cancelRef.cancelled) { videoEncoder.close(); return null; }
    const ts = i / COVER_FPS;
    await encodeCanvasFrame(coverCanvas, ts, i % COVER_FPS === 0);
  }

  // ── Phase 2: video with effects ─────────────────────────────────────────────
  onProgress(0.08, "Processando vídeo…");
  await new Promise<void>((res) => {
    if (video.currentTime === 0) return res();
    const hh = () => { video.removeEventListener("seeked", hh); res(); };
    video.addEventListener("seeked", hh);
    video.currentTime = 0;
  });
  video.play().catch(() => {});

  let lastVideoTs = 0;
  await new Promise<void>((resolve, reject) => {
    let finished = false;
    const done = () => { if (!finished) { finished = true; video.pause(); resolve(); } };
    const safety = setTimeout(done, (videoDuration + 20) * 1000);
    video.onended = () => { clearTimeout(safety); done(); };

    const cb = (_n: DOMHighResTimeStamp, meta: { mediaTime: number }) => {
      if (cancelRef.cancelled || finished) { clearTimeout(safety); done(); return; }
      try {
        const mt = meta.mediaTime;
        if (mt * 1_000_000 > lastVideoTs) {
          renderVideoFrame(mt);
          const ts = introSec + mt;
          const vf = new VideoFrame(glCanvas, { timestamp: Math.round(ts * 1_000_000) });
          videoEncoder.encode(vf, { keyFrame: frameIndex % 60 === 0 });
          vf.close();
          frameIndex++;
          lastVideoTs = Math.round(mt * 1_000_000);
          onProgress(0.08 + Math.min(mt / videoDuration, 1) * 0.55, "Processando vídeo…");
          if (videoEncoder.encodeQueueSize > 8) {
            // best-effort throttle without blocking the RVFC callback flow
          }
        }
        video.requestVideoFrameCallback(cb);
      } catch (e) { clearTimeout(safety); reject(e); }
    };
    video.requestVideoFrameCallback(cb);
  });
  if (cancelRef.cancelled) { videoEncoder.close(); return null; }

  const videoEndTs = introSec + videoDuration;

  // ── Phase 3: outro cover (5 min) ────────────────────────────────────────────
  onProgress(0.64, "Segurando capa por 5 minutos…");
  const outroFrames = Math.round(outroSec * COVER_FPS);
  for (let i = 0; i < outroFrames; i++) {
    if (cancelRef.cancelled) { videoEncoder.close(); return null; }
    const ts = videoEndTs + i / COVER_FPS;
    await encodeCanvasFrame(coverCanvas, ts, i % (COVER_FPS * 2) === 0);
    if (i % 30 === 0) onProgress(0.64 + (i / outroFrames) * 0.22, "Segurando capa por 5 minutos…");
  }

  await videoEncoder.flush();
  videoEncoder.close();

  // ── Audio: silence during covers, real audio during the video window ────────
  if (hasAudio && audioBuf) {
    onProgress(0.88, "Codificando áudio…");
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => console.error("AudioEncoder:", e),
    });
    audioEncoder.configure({
      codec: "mp4a.40.2",
      sampleRate: audioSampleRate,
      numberOfChannels: 2,
      bitrate: 128_000,
    });

    const sr = audioSampleRate;
    const CHUNK = 1024;
    const totalSamples = Math.ceil(totalDuration * sr);
    const introSamples = Math.round(introSec * sr);
    const videoSamples = audioBuf.length;
    const aCh0 = audioBuf.getChannelData(0);
    const aCh1 = audioBuf.numberOfChannels > 1 ? audioBuf.getChannelData(1) : aCh0;

    for (let i = 0; i < totalSamples; i += CHUNK) {
      if (cancelRef.cancelled) { audioEncoder.close(); return null; }
      const frames = Math.min(CHUNK, totalSamples - i);
      const planar = new Float32Array(frames * 2); // zeroed = silence

      // Overlap of [i, i+frames) with the video window [introSamples, introSamples+videoSamples)
      const winStart = introSamples;
      const winEnd = introSamples + videoSamples;
      const from = Math.max(i, winStart);
      const to = Math.min(i + frames, winEnd);
      if (from < to) {
        for (let s = from; s < to; s++) {
          const dst = s - i;              // index within this chunk
          const srcIdx = s - introSamples; // index within processed audio
          planar[dst] = aCh0[srcIdx];
          planar[frames + dst] = aCh1[srcIdx];
        }
      }

      const ad = new AudioData({
        format: "f32-planar",
        sampleRate: sr,
        numberOfChannels: 2,
        numberOfFrames: frames,
        timestamp: Math.round((i / sr) * 1_000_000),
        data: planar,
      });
      audioEncoder.encode(ad);
      ad.close();
    }
    await audioEncoder.flush();
    audioEncoder.close();
  }

  muxer.finalize();

  // Strip identifying metadata (creation timestamps + tool handler name)
  onProgress(0.98, "Limpando metadados…");
  cleanMp4Metadata(target.buffer);

  onProgress(1, "Concluído");

  // Cleanup — release object URLs and GPU resources so nothing lingers
  URL.revokeObjectURL(video.src);
  URL.revokeObjectURL(coverImg.src);
  gl.deleteProgram(program);

  return new Blob([target.buffer], { type: "video/mp4" });
}
