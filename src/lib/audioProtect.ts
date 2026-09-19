import { cleanMp4Metadata } from "@/lib/mp4Metadata";

export interface AudioProtectOptions {
  videoFile: File;
  onProgress: (ratio: number, phase: string) => void;
  cancelRef: { cancelled: boolean };
}

const VIDEO_FPS = 30;
const OUT_RATE = 48000;

// ── WebCodecs helpers (self-contained) ───────────────────────────────────────
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

const H264_CANDIDATES = [
  "avc1.640028", "avc1.4d0028", "avc1.42e028", "avc1.640020", "avc1.4d001f", "avc1.42001f",
];
async function pickVideoCodec(w: number, h: number, fps: number, bitrate: number): Promise<string | null> {
  for (const codec of H264_CANDIDATES) {
    try {
      for (const hw of ["no-preference", "prefer-software", "prefer-hardware"] as const) {
        const r = await VideoEncoder.isConfigSupported({ codec, width: w, height: h, bitrate, framerate: fps, hardwareAcceleration: hw });
        if (r.supported) return codec;
      }
    } catch { /* next */ }
  }
  return null;
}

function loadVideo(file: File): Promise<HTMLVideoElement> {
  return new Promise((res, rej) => {
    const v = document.createElement("video");
    v.muted = true; v.playsInline = true; v.crossOrigin = "anonymous";
    v.onloadedmetadata = () => res(v);
    v.onerror = rej;
    v.src = URL.createObjectURL(file);
  });
}

// ── Audio obfuscation building blocks ────────────────────────────────────────

// Reversed copy of the decoded audio → semantically empty "babble" that
// confuses ASR while humans read it as background noise.
function reverseBuffer(ctx: BaseAudioContext, decoded: AudioBuffer): AudioBuffer {
  const ch = Math.min(decoded.numberOfChannels, 2);
  const out = ctx.createBuffer(ch, decoded.length, decoded.sampleRate);
  for (let c = 0; c < ch; c++) {
    const src = decoded.getChannelData(c);
    const dst = out.getChannelData(c);
    const n = src.length;
    for (let i = 0; i < n; i++) dst[i] = src[n - 1 - i];
  }
  return out;
}

// Short decaying-noise impulse response → smears phonemes (reverb).
function makeImpulse(ctx: BaseAudioContext, seconds: number, decay: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = ir.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return ir;
}

// Band-limited noise buffer (speech band) → constant confusing floor.
function makeNoise(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

/**
 * Builds an aggressively obfuscated version of the video's audio: intelligible
 * to a human (foreground voice stays dominant) but hard for automatic
 * transcription (competing/reversed speech layers, pitch warble, tremolo,
 * reverb smearing, and a speech-band noise floor). Rendered at 48000 Hz.
 */
async function buildProtectedAudio(file: File): Promise<AudioBuffer | null> {
  let decoded: AudioBuffer;
  try {
    const buf = await file.arrayBuffer();
    const tmp = new AudioContext();
    try { decoded = await tmp.decodeAudioData(buf); }
    finally { await tmp.close(); }
  } catch {
    return null; // no decodable audio track
  }

  const dur = decoded.duration;
  const len = Math.max(1, Math.ceil(dur * OUT_RATE));
  const off = new OfflineAudioContext(2, len, OUT_RATE);

  const master = off.createDynamicsCompressor();
  master.threshold.value = -16; master.knee.value = 8; master.ratio.value = 4;
  master.attack.value = 0.003; master.release.value = 0.25;
  master.connect(off.destination);

  // Reverb bus (smears phonemes)
  const convolver = off.createConvolver();
  convolver.buffer = makeImpulse(off, 0.4, 2.2);
  const wet = off.createGain(); wet.gain.value = 0.45;
  convolver.connect(wet); wet.connect(master);

  // ── Foreground voice (kept dominant) + pitch warble ──
  const voice = off.createBufferSource();
  voice.buffer = decoded;
  const voiceGain = off.createGain(); voiceGain.gain.value = 1.0;
  voice.connect(voiceGain);
  voiceGain.connect(master);
  voiceGain.connect(convolver);

  // Warble: two LFOs modulating detune (±~70 cents, wandering) — disrupts the
  // acoustic features ASR relies on, humans tolerate it as slight wobble.
  const lfo1 = off.createOscillator(); lfo1.frequency.value = 6.0;
  const lfo1g = off.createGain(); lfo1g.gain.value = 55;
  lfo1.connect(lfo1g); lfo1g.connect(voice.detune);
  const lfo2 = off.createOscillator(); lfo2.frequency.value = 0.7;
  const lfo2g = off.createGain(); lfo2g.gain.value = 25;
  lfo2.connect(lfo2g); lfo2g.connect(voice.detune);
  lfo1.start(); lfo2.start();

  // Helper to add a competing-speech layer with delay/pitch/tremolo
  const addLayer = (
    bufSource: AudioBuffer, rate: number, detune: number, delaySec: number,
    gainVal: number, tremHz: number
  ) => {
    const s = off.createBufferSource();
    s.buffer = bufSource;
    s.playbackRate.value = rate;
    s.detune.value = detune;
    const g = off.createGain(); g.gain.value = gainVal;
    // tremolo
    const trem = off.createOscillator(); trem.frequency.value = tremHz;
    const tremG = off.createGain(); tremG.gain.value = gainVal * 0.5;
    trem.connect(tremG); tremG.connect(g.gain);
    let node: AudioNode = s;
    if (delaySec > 0) {
      const d = off.createDelay(1.0); d.delayTime.value = delaySec;
      s.connect(d); node = d;
    }
    node.connect(g);
    g.connect(master);
    g.connect(convolver);
    trem.start();
    s.start();
  };

  const reversed = reverseBuffer(off, decoded);

  // Competing layer A: pitched-down, slightly slower, delayed
  addLayer(decoded, 0.94, -350, 0.20, 0.55, 17);
  // Competing layer B: reversed babble, pitched up
  addLayer(reversed, 1.08, 250, 0.0, 0.5, 23);
  // Competing layer C: pitched up, longer delay
  addLayer(decoded, 1.05, 420, 0.45, 0.42, 13);
  // Competing layer D: reversed, slower
  addLayer(reversed, 0.9, -180, 0.32, 0.4, 29);

  // Speech-band noise floor
  const noise = off.createBufferSource();
  noise.buffer = makeNoise(off, dur + 1);
  noise.loop = true;
  const bp = off.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1600; bp.Q.value = 0.7;
  const ng = off.createGain(); ng.gain.value = 0.09;
  noise.connect(bp); bp.connect(ng); ng.connect(master);

  voice.start();
  noise.start();

  return off.startRendering();
}

// ── Full pipeline: passthrough video + protected audio → MP4 ─────────────────
export async function protectVideoAudio(opts: AudioProtectOptions): Promise<Blob | null> {
  const { videoFile, onProgress, cancelRef } = opts;

  if (typeof window !== "undefined" && !window.isSecureContext) {
    throw new Error("Acesse o site por HTTPS para processar (WebCodecs exige conexão segura).");
  }
  if (!videoCodecsAvailable()) {
    throw new Error("Seu navegador não suporta WebCodecs de vídeo. Use o Chrome ou Edge atualizado no desktop.");
  }

  const { Muxer, ArrayBufferTarget } = await import("mp4-muxer");

  onProgress(0.02, "Carregando vídeo…");
  const video = await loadVideo(videoFile);
  const w = (video.videoWidth || 720) & ~1;
  const h = (video.videoHeight || 1280) & ~1;
  const duration = video.duration;

  // Passthrough draw canvas (re-encode video unchanged)
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d")!;

  const VIDEO_BITRATE = 4_000_000;
  const codec = await pickVideoCodec(w, h, VIDEO_FPS, VIDEO_BITRATE);
  if (!codec) throw new Error("Nenhum codec H.264 compatível encontrado neste navegador.");

  const target = new ArrayBufferTarget();

  // Build protected audio first (so muxer can declare a valid audio track)
  onProgress(0.05, "Blindando áudio contra transcrição…");
  let audioBuf = audioCodecsAvailable() ? await buildProtectedAudio(videoFile) : null;
  if (audioBuf) {
    try {
      const sup = await AudioEncoder.isConfigSupported({ codec: "mp4a.40.2", sampleRate: OUT_RATE, numberOfChannels: 2, bitrate: 128_000 });
      if (!sup.supported) audioBuf = null;
    } catch { audioBuf = null; }
  }
  const hasAudio = !!audioBuf;
  if (cancelRef.cancelled) return null;

  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: w, height: h },
    ...(hasAudio ? { audio: { codec: "aac", numberOfChannels: 2, sampleRate: OUT_RATE } } : {}),
    firstTimestampBehavior: "offset",
    fastStart: "in-memory",
  });

  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => console.error("VideoEncoder:", e),
  });
  videoEncoder.configure({
    codec, width: w, height: h, bitrate: VIDEO_BITRATE, framerate: VIDEO_FPS,
    hardwareAcceleration: "no-preference", avc: { format: "avc" },
  });

  // Seek-based CFR capture (no effects — passthrough)
  const seekTo = (t: number) => new Promise<void>((res) => {
    if (Math.abs(video.currentTime - t) < 1e-4 && video.readyState >= 2) { res(); return; }
    const onSeeked = () => { video.removeEventListener("seeked", onSeeked); res(); };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = t;
  });

  await new Promise<void>((res) => {
    const onSeeked = () => { video.removeEventListener("seeked", onSeeked); res(); };
    video.addEventListener("seeked", onSeeked);
    video.currentTime = 0.001;
  });

  const totalFrames = Math.max(1, Math.round(duration * VIDEO_FPS));
  for (let f = 0; f < totalFrames; f++) {
    if (cancelRef.cancelled) { videoEncoder.close(); return null; }
    const t = Math.min(f / VIDEO_FPS, Math.max(0, duration - 1e-3));
    await seekTo(t);
    ctx.drawImage(video, 0, 0, w, h);
    const vf = new VideoFrame(canvas, { timestamp: Math.round((f / VIDEO_FPS) * 1_000_000) });
    videoEncoder.encode(vf, { keyFrame: f % 60 === 0 });
    vf.close();
    if (videoEncoder.encodeQueueSize > 8) {
      await new Promise<void>((r) => { const c = () => (videoEncoder.encodeQueueSize <= 4 ? r() : setTimeout(c, 8)); c(); });
    }
    if (f % 5 === 0) onProgress(0.08 + (f / totalFrames) * 0.72, "Reprocessando vídeo…");
  }
  if (cancelRef.cancelled) { videoEncoder.close(); return null; }

  await videoEncoder.flush();
  videoEncoder.close();

  // Encode the protected audio
  if (hasAudio && audioBuf) try {
    onProgress(0.86, "Codificando áudio blindado…");
    const audioEncoder = new AudioEncoder({
      output: (chunk, meta) => muxer.addAudioChunk(chunk, meta),
      error: (e) => console.error("AudioEncoder:", e),
    });
    audioEncoder.configure({ codec: "mp4a.40.2", sampleRate: OUT_RATE, numberOfChannels: 2, bitrate: 128_000 });

    const CHUNK = 1024;
    const totalSamples = audioBuf.length;
    const a0 = audioBuf.getChannelData(0);
    const a1 = audioBuf.numberOfChannels > 1 ? audioBuf.getChannelData(1) : a0;
    for (let i = 0; i < totalSamples; i += CHUNK) {
      if (cancelRef.cancelled) { audioEncoder.close(); return null; }
      const frames = Math.min(CHUNK, totalSamples - i);
      const planar = new Float32Array(frames * 2);
      planar.set(a0.subarray(i, i + frames), 0);
      planar.set(a1.subarray(i, i + frames), frames);
      const ad = new AudioData({
        format: "f32-planar", sampleRate: OUT_RATE, numberOfChannels: 2,
        numberOfFrames: frames, timestamp: Math.round((i / OUT_RATE) * 1_000_000), data: planar,
      });
      audioEncoder.encode(ad); ad.close();
    }
    await audioEncoder.flush();
    audioEncoder.close();
  } catch (e) {
    console.warn("Protected audio encoding failed — exporting without audio:", e);
  }

  muxer.finalize();
  onProgress(0.98, "Limpando metadados…");
  cleanMp4Metadata(target.buffer);
  onProgress(1, "Concluído");

  URL.revokeObjectURL(video.src);
  return new Blob([target.buffer], { type: "video/mp4" });
}
