import { createProgram, setupFullscreenQuad, createTexture, uploadVideoTexture } from "@/lib/shaderLoader";
import { cleanMp4Metadata } from "@/lib/mp4Metadata";
import { buildProtectedAudioBuffer } from "@/lib/audioProtect";

export interface CreativeOptions {
  coverFile: File;              // shown at the start (intro)
  videoFile: File;
  endCoverFile?: File;          // shown for the 5-min tail; falls back to coverFile
  protectionLevel?: number;     // 0–100 (default 100); scales all visual effects
  tvLines?: number;             // 0–100 (default 0); TV scanline intensity
  audioProtection?: {           // when enabled, obfuscates the video's audio
    enabled: boolean;
    intensity?: number;         // 0–100
    decoyFile?: File | null;
    decoyGain?: number;         // 0–100
    stereoCancel?: number;      // 0–100
    noise?: number;             // 0–100
  };
  onProgress: (ratio: number, phase: string) => void;
  cancelRef: { cancelled: boolean };
  introSeconds?: number;  // override for testing; defaults to INTRO_SECONDS
  outroSeconds?: number;  // override for testing; defaults to OUTRO_SECONDS
}

// ── Fixed pipeline constants (matches reference SaaS behaviour) ──────────────
const INTRO_SECONDS = 1;      // cover shown briefly at the start
const OUTRO_SECONDS = 300;    // cover held for 5 minutes at the end
const VIDEO_FPS     = 30;
const COVER_FPS     = 30;     // match video fps → whole file is constant-rate (CFR)

// Baked-in effect preset applied to the video portion.
// Tuned for a clean, natural, "competitor-style" look: gentle punch, almost
// no colour fringing, light grain, and a smooth visible brightness pulse.
const PRESET = {
  contrast:   0.30,   // gentle curve (~1.15x) — natural, not harsh
  chromatic:  0.04,   // barely-there; hash uniqueness comes from u_hash_seed
  noise:      0.10,   // very light grain
  pixelation: 0.0,    // off — keep it crisp/clean
  flash:      1.0,    // drives the smooth ~±2.5% breathing pulse
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

  // AAC only supports 44100/48000 Hz. Always render at 48000 Hz — the
  // BufferSource is resampled to the context's rate automatically, so the
  // returned buffer is guaranteed to be a rate the encoder accepts.
  const outRate = 48000;
  const outLength = Math.max(1, Math.ceil(decoded.duration * outRate));

  const ch = Math.min(decoded.numberOfChannels, 2);
  const off = new OfflineAudioContext(2, outLength, outRate);
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
  const { coverFile, videoFile, endCoverFile, onProgress, cancelRef } = opts;
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
  // Optional distinct end image; falls back to the intro cover
  const endImg = endCoverFile ? await loadImage(endCoverFile) : coverImg;

  // Output dimensions — force even for H.264
  const w = (video.videoWidth  || 720)  & ~1;
  const h = (video.videoHeight || 1280) & ~1;
  const videoDuration = video.duration;
  const totalDuration = introSec + videoDuration + outroSec;

  // ── Cover 2D canvas (intro frames) ─────────────────────────────────────────
  const coverCanvas = document.createElement("canvas");
  coverCanvas.width = w; coverCanvas.height = h;
  drawCover(coverCanvas.getContext("2d")!, coverImg, w, h);

  // ── End-cover 2D canvas (outro frames) — same canvas if no distinct end image
  let endCanvas = coverCanvas;
  if (endImg !== coverImg) {
    endCanvas = document.createElement("canvas");
    endCanvas.width = w; endCanvas.height = h;
    drawCover(endCanvas.getContext("2d")!, endImg, w, h);
  }

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
  const uProtection = loc("u_protection");
  const uTvlines    = loc("u_tvlines");
  const uResY       = loc("u_res_y");
  const uTime       = loc("u_time");
  const uTexture    = loc("u_texture");
  const uPrev       = loc("u_prev_texture");

  // Global protection level (0–1) scales every visual effect
  const kProt = Math.max(0, Math.min(1, (opts.protectionLevel ?? 100) / 100));
  const kTv   = Math.max(0, Math.min(1, (opts.tvLines ?? 0) / 100));

  const renderVideoFrame = (mediaTime: number) => {
    uploadVideoTexture(gl, tex, video);
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniform1f(uContrast,  PRESET.contrast * kProt);
    gl.uniform1f(uChromatic, PRESET.chromatic * kProt);
    gl.uniform1f(uMotion,    0);
    gl.uniform1f(uNoiseDens, PRESET.noise * kProt);
    gl.uniform1f(uNoiseOn,   kProt > 0 ? 1 : 0);
    gl.uniform1f(uFlipV,     0);
    gl.uniform1f(uFlipH,     0);
    gl.uniform1f(uHash,      hashSeed);
    gl.uniform1f(uPixel,     PRESET.pixelation * kProt);
    gl.uniform1f(uFlash,     PRESET.flash > 0 && kProt > 0 ? 1 : 0);
    gl.uniform1f(uProtection, kProt);
    gl.uniform1f(uTvlines,   kTv);
    gl.uniform1f(uResY,      h);
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

  // Audio is optional — only if the WebCodecs audio API + a decodable track
  // exist AND the encoder actually accepts the (resampled) rate. If anything
  // is off, the creative is exported silent instead of failing the whole job.
  const ap = opts.audioProtection;
  let audioBuf = audioCodecsAvailable()
    ? (ap?.enabled
        ? await buildProtectedAudioBuffer(videoFile, {
            intensity: ap.intensity, decoyFile: ap.decoyFile, decoyGain: ap.decoyGain,
            stereoCancel: ap.stereoCancel, noise: ap.noise,
          })
        : await processAudio(videoFile))
    : null;
  const audioSampleRate = 48000; // processAudio always renders at 48000 Hz
  if (audioBuf) {
    try {
      const sup = await AudioEncoder.isConfigSupported({
        codec: "mp4a.40.2", sampleRate: audioSampleRate, numberOfChannels: 2, bitrate: 128_000,
      });
      if (!sup.supported) { console.warn("AAC config unsupported — exporting silent"); audioBuf = null; }
    } catch (e) { console.warn("audio config check failed — exporting silent", e); audioBuf = null; }
  }
  const hasAudio = !!audioBuf;

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

  // ── Phase 2: video with effects (deterministic seek-based CFR capture) ──────
  // Real-time RVFC capture drops frames under load and produces variable-rate
  // (VFR) output that stutters in players like QuickTime. Instead we seek to
  // every 1/fps position, render it, and stamp it at an evenly-spaced timestamp.
  // Result: exact constant 30fps, no dropped frames, perfect audio sync.
  onProgress(0.08, "Processando vídeo…");
  video.pause();

  const seekTo = (t: number) =>
    new Promise<void>((res) => {
      if (Math.abs(video.currentTime - t) < 1e-4 && video.readyState >= 2) { res(); return; }
      const onSeeked = () => { video.removeEventListener("seeked", onSeeked); res(); };
      video.addEventListener("seeked", onSeeked);
      video.currentTime = t;
    });

  // Prime: decode the first frame so texImage2D has valid pixels
  await new Promise<void>((res) => {
    const onSeeked = () => { video.removeEventListener("seeked", onSeeked); res(); };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = 0.001;
  });

  const totalVideoFrames = Math.max(1, Math.round(videoDuration * VIDEO_FPS));
  for (let f = 0; f < totalVideoFrames; f++) {
    if (cancelRef.cancelled) { videoEncoder.close(); return null; }

    const srcT = Math.min(f / VIDEO_FPS, Math.max(0, videoDuration - 1e-3));
    await seekTo(srcT);

    renderVideoFrame(srcT);
    const ts = introSec + f / VIDEO_FPS;   // evenly spaced → constant frame rate
    const vf = new VideoFrame(glCanvas, { timestamp: Math.round(ts * 1_000_000) });
    videoEncoder.encode(vf, { keyFrame: f % 60 === 0 });
    vf.close();
    frameIndex++;

    if (videoEncoder.encodeQueueSize > 8) {
      await new Promise<void>((r) => {
        const check = () => (videoEncoder.encodeQueueSize <= 4 ? r() : setTimeout(check, 8));
        check();
      });
    }
    if (f % 5 === 0) onProgress(0.08 + (f / totalVideoFrames) * 0.55, "Processando vídeo…");
  }
  if (cancelRef.cancelled) { videoEncoder.close(); return null; }

  const videoEndTs = introSec + totalVideoFrames / VIDEO_FPS;

  // ── Phase 3: outro cover (5 min) ────────────────────────────────────────────
  onProgress(0.64, "Segurando capa por 5 minutos…");
  const outroFrames = Math.round(outroSec * COVER_FPS);
  for (let i = 0; i < outroFrames; i++) {
    if (cancelRef.cancelled) { videoEncoder.close(); return null; }
    const ts = videoEndTs + i / COVER_FPS;
    await encodeCanvasFrame(endCanvas, ts, i % (COVER_FPS * 2) === 0);
    if (i % 30 === 0) onProgress(0.64 + (i / outroFrames) * 0.22, "Segurando capa por 5 minutos…");
  }

  await videoEncoder.flush();
  videoEncoder.close();

  // ── Audio: silence during covers, real audio during the video window ────────
  // Wrapped so any unexpected audio failure never aborts the export — the
  // video is already fully encoded; worst case the file is exported silent.
  if (hasAudio && audioBuf) try {
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
  } catch (e) {
    console.warn("Audio encoding failed — exporting without audio:", e);
  }

  muxer.finalize();

  // Strip identifying metadata (creation timestamps + tool handler name)
  onProgress(0.98, "Limpando metadados…");
  cleanMp4Metadata(target.buffer);

  onProgress(1, "Concluído");

  // Cleanup — release object URLs and GPU resources so nothing lingers
  URL.revokeObjectURL(video.src);
  URL.revokeObjectURL(coverImg.src);
  if (endImg !== coverImg) URL.revokeObjectURL(endImg.src);
  gl.deleteProgram(program);

  return new Blob([target.buffer], { type: "video/mp4" });
}

/**
 * Renders a short silent preview clip (first `seconds`) of just the video with
 * the visual effects applied at `protectionLevel` (0–100) — no cover, no tail.
 * Uses the exact same shader pipeline as the export, so it's WYSIWYG. Returns
 * a playable MP4 blob for an inline <video>.
 */
export async function previewCreativeVideo(
  videoFile: File, protectionLevel: number, seconds = 4, tvLines = 0
): Promise<Blob | null> {
  if (typeof window !== "undefined" && !window.isSecureContext) return null;
  if (!videoCodecsAvailable()) return null;

  const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");
  const video = await loadVideo(videoFile);
  const w = (video.videoWidth  || 720)  & ~1;
  const h = (video.videoHeight || 1280) & ~1;
  const dur = Math.min(seconds, video.duration || seconds);
  const kProt = Math.max(0, Math.min(1, protectionLevel / 100));
  const kTv = Math.max(0, Math.min(1, tvLines / 100));

  const glCanvas = document.createElement("canvas");
  glCanvas.width = w; glCanvas.height = h;
  const gl = glCanvas.getContext("webgl2");
  if (!gl) { URL.revokeObjectURL(video.src); return null; }

  const fragSrc = await fetch(FRAG_GLSL_PATH).then((r) => r.text());
  const program = createProgram(gl, fragSrc);
  const vao = setupFullscreenQuad(gl, program);
  const tex = createTexture(gl);
  gl.viewport(0, 0, w, h);
  gl.useProgram(program);

  const hashSeed = Math.random();
  const loc = (n: string) => gl.getUniformLocation(program, n);
  const U = {
    contrast: loc("u_contrast_curve"), chromatic: loc("u_chromatic_offset"),
    motion: loc("u_motion_blur_weight"), noiseD: loc("u_noise_density"),
    noiseOn: loc("u_noise_enabled"), flipV: loc("u_flip_v"), flipH: loc("u_flip_h"),
    hash: loc("u_hash_seed"), pixel: loc("u_crackle_intensity"), flash: loc("u_flash"),
    prot: loc("u_protection"), tv: loc("u_tvlines"), resY: loc("u_res_y"),
    time: loc("u_time"), texture: loc("u_texture"), prev: loc("u_prev_texture"),
  };

  const renderFrame = (mediaTime: number) => {
    uploadVideoTexture(gl, tex, video);
    gl.useProgram(program); gl.bindVertexArray(vao);
    gl.uniform1f(U.contrast,  PRESET.contrast * kProt);
    gl.uniform1f(U.chromatic, PRESET.chromatic * kProt);
    gl.uniform1f(U.motion,    0);
    gl.uniform1f(U.noiseD,    PRESET.noise * kProt);
    gl.uniform1f(U.noiseOn,   kProt > 0 ? 1 : 0);
    gl.uniform1f(U.flipV,     0);
    gl.uniform1f(U.flipH,     0);
    gl.uniform1f(U.hash,      hashSeed);
    gl.uniform1f(U.pixel,     PRESET.pixelation * kProt);
    gl.uniform1f(U.flash,     PRESET.flash > 0 && kProt > 0 ? 1 : 0);
    gl.uniform1f(U.prot,      kProt);
    gl.uniform1f(U.tv,        kTv);
    gl.uniform1f(U.resY,      h);
    gl.uniform1f(U.time,      mediaTime);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.texture, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex); gl.uniform1i(U.prev, 1);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    gl.finish();
  };

  const codec = await pickVideoCodec(w, h, VIDEO_FPS, 4_000_000);
  if (!codec) { URL.revokeObjectURL(video.src); gl.deleteProgram(program); return null; }

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target, video: { codec: "avc", width: w, height: h },
    firstTimestampBehavior: "offset", fastStart: "in-memory",
  });
  const enc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error("preview VideoEncoder:", e),
  });
  enc.configure({ codec, width: w, height: h, bitrate: 4_000_000, framerate: VIDEO_FPS,
    hardwareAcceleration: "no-preference", avc: { format: "avc" } });

  const seekTo = (t: number) => new Promise<void>((res) => {
    if (Math.abs(video.currentTime - t) < 1e-4 && video.readyState >= 2) { res(); return; }
    const h2 = () => { video.removeEventListener("seeked", h2); res(); };
    video.addEventListener("seeked", h2); video.currentTime = t;
  });
  await new Promise<void>((res) => {
    const h2 = () => { video.removeEventListener("seeked", h2); res(); };
    video.addEventListener("seeked", h2); video.currentTime = 0.001;
  });

  const total = Math.max(1, Math.round(dur * VIDEO_FPS));
  for (let f = 0; f < total; f++) {
    const t = Math.min(f / VIDEO_FPS, Math.max(0, dur - 1e-3));
    await seekTo(t);
    renderFrame(t);
    const vf = new VideoFrame(glCanvas, { timestamp: Math.round((f / VIDEO_FPS) * 1_000_000) });
    enc.encode(vf, { keyFrame: f % 30 === 0 });
    vf.close();
    if (enc.encodeQueueSize > 8) {
      await new Promise<void>((r) => { const c = () => (enc.encodeQueueSize <= 4 ? r() : setTimeout(c, 8)); c(); });
    }
  }
  await enc.flush(); enc.close();
  muxer.finalize();
  cleanMp4Metadata(target.buffer);

  URL.revokeObjectURL(video.src);
  gl.deleteProgram(program);
  return new Blob([target.buffer], { type: "video/mp4" });
}
