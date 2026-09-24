import { cleanMp4Metadata } from "@/lib/mp4Metadata";

export interface AudioProtectOptions {
  videoFile: File;
  intensity?: number;    // 0–100 (default 100); pitch warble on the real voice
  decoyFile?: File;      // optional "white" audio laid underneath (clean)
  decoyGain?: number;    // 0–100 (default 75); how loud the decoy sits
  stereoCancel?: number; // 0–100 (default 0); real voice cancels in mono downmix
  noise?: number;        // 0–100 (default 0); speech-band noise floor
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
async function decodeFile(file: File): Promise<AudioBuffer | null> {
  try {
    const buf = await file.arrayBuffer();
    const tmp = new AudioContext();
    try { return await tmp.decodeAudioData(buf); }
    finally { await tmp.close(); }
  } catch {
    return null; // no decodable audio track
  }
}

// Copy the first `seconds` of a decoded buffer (for fast previews).
function trimBuffer(ctx: BaseAudioContext, decoded: AudioBuffer, seconds: number): AudioBuffer {
  const n = Math.min(decoded.length, Math.ceil(seconds * decoded.sampleRate));
  const ch = Math.min(decoded.numberOfChannels, 2);
  const out = ctx.createBuffer(ch, n, decoded.sampleRate);
  for (let c = 0; c < ch; c++) out.getChannelData(c).set(decoded.getChannelData(c).subarray(0, n));
  return out;
}

interface RenderOpts {
  intensity: number;              // 0–1 — pitch warble on the REAL voice
  decoy?: AudioBuffer | null;     // clean "white" track laid underneath
  decoyGain?: number;             // 0–1 — how loud the decoy sits (default 0.75)
  stereoCancel?: number;          // 0–1 — real voice phase-cancels in mono downmix
  noise?: number;                 // 0–1 — speech-band noise floor
}

/**
 * Renders the protected audio at 48000 Hz.
 *
 * Key weapon (decoy + stereoCancel): ASR engines like Whisper/TurboScribe
 * downmix to MONO before transcribing. We put the REAL voice in opposite
 * phase across L/R (scaled by `stereoCancel`) so it CANCELS in the mono sum —
 * the transcriber barely hears it — while the clean decoy sits centered and
 * survives the sum, so that's what gets transcribed. A human on
 * stereo/headphones still hears the real voice (as a wide/spatial signal).
 *
 * Without a decoy: layered obfuscation (reversed/competing babble + warble +
 * reverb + noise) that garbles automatic transcription.
 */
async function renderProtected(decoded: AudioBuffer, opts: RenderOpts): Promise<AudioBuffer> {
  const k = Math.max(0, Math.min(1, opts.intensity));
  const decoy = opts.decoy ?? null;
  const decoyGain = Math.max(0, Math.min(1, opts.decoyGain ?? 0.75));
  const cancel = Math.max(0, Math.min(1, opts.stereoCancel ?? 0));
  const noiseAmt = Math.max(0, Math.min(1, opts.noise ?? 0));
  const dur = decoded.duration;
  const len = Math.max(1, Math.ceil(dur * OUT_RATE));
  const off = new OfflineAudioContext(2, len, OUT_RATE);

  const master = off.createDynamicsCompressor();
  master.threshold.value = -16; master.knee.value = 8; master.ratio.value = 4;
  master.attack.value = 0.003; master.release.value = 0.25;
  master.connect(off.destination);

  // Real voice source + pitch warble (identical to L & R so cancellation holds)
  const voice = off.createBufferSource();
  voice.buffer = decoded;
  if (k > 0) {
    const lfo1 = off.createOscillator(); lfo1.frequency.value = 6.0;
    const lfo1g = off.createGain(); lfo1g.gain.value = 55 * k;
    lfo1.connect(lfo1g); lfo1g.connect(voice.detune);
    const lfo2 = off.createOscillator(); lfo2.frequency.value = 0.7;
    const lfo2g = off.createGain(); lfo2g.gain.value = 25 * k;
    lfo2.connect(lfo2g); lfo2g.connect(voice.detune);
    lfo1.start(); lfo2.start();
  }

  const addNoise = (gainVal: number) => {
    if (gainVal < 0.001) return;
    const n = off.createBufferSource();
    n.buffer = makeNoise(off, dur + 1); n.loop = true;
    const bp = off.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1600; bp.Q.value = 0.7;
    const ng = off.createGain(); ng.gain.value = gainVal;
    n.connect(bp); bp.connect(ng); ng.connect(master);
    n.start();
  };

  if (decoy) {
    // ── STEREO MONO-CANCEL MODE ──
    // Real voice split L/R; R scaled by (1 - 2*cancel):
    //   cancel=0 → in phase (mono keeps full voice)
    //   cancel=1 → anti-phase (mono sum of voice ≈ 0 → hidden from ASR)
    const merger = off.createChannelMerger(2);
    const gL = off.createGain(); gL.gain.value = 1.0;
    const gR = off.createGain(); gR.gain.value = 1.0 - 2.0 * cancel;
    voice.connect(gL); voice.connect(gR);
    gL.connect(merger, 0, 0);
    gR.connect(merger, 0, 1);
    merger.connect(master);

    // Decoy: clean, centered (survives mono sum), looped to fill duration
    const dsrc = off.createBufferSource();
    dsrc.buffer = decoy; dsrc.loop = true;
    const dg = off.createGain(); dg.gain.value = decoyGain;
    dsrc.connect(dg); dg.connect(master);
    dsrc.start();

    addNoise(noiseAmt * 0.12);
    voice.start();
    return off.startRendering();
  }

  // ── OBFUSCATION MODE (no decoy) ──
  const convolver = off.createConvolver();
  convolver.buffer = makeImpulse(off, 0.4, 2.2);
  const wet = off.createGain(); wet.gain.value = 0.45 * k;
  convolver.connect(wet); wet.connect(master);

  const voiceGain = off.createGain(); voiceGain.gain.value = 1.0;
  voice.connect(voiceGain);
  voiceGain.connect(master);
  if (k > 0) voiceGain.connect(convolver);

  const addLayer = (
    bufSource: AudioBuffer, rate: number, detune: number, delaySec: number,
    baseGain: number, tremHz: number
  ) => {
    const gainVal = baseGain * k;
    if (gainVal < 0.001) return;
    const s = off.createBufferSource();
    s.buffer = bufSource; s.playbackRate.value = rate; s.detune.value = detune;
    const g = off.createGain(); g.gain.value = gainVal;
    const trem = off.createOscillator(); trem.frequency.value = tremHz;
    const tremG = off.createGain(); tremG.gain.value = gainVal * 0.5;
    trem.connect(tremG); tremG.connect(g.gain);
    let node: AudioNode = s;
    if (delaySec > 0) { const d = off.createDelay(1.0); d.delayTime.value = delaySec; s.connect(d); node = d; }
    node.connect(g); g.connect(master); g.connect(convolver);
    trem.start(); s.start();
  };

  if (k > 0) {
    const reversed = reverseBuffer(off, decoded);
    addLayer(decoded, 0.94, -350, 0.20, 0.55, 17);
    addLayer(reversed, 1.08, 250, 0.0, 0.5, 23);
    addLayer(decoded, 1.05, 420, 0.45, 0.42, 13);
    addLayer(reversed, 0.9, -180, 0.32, 0.4, 29);
  }
  addNoise(Math.max(noiseAmt * 0.12, k * 0.09));

  voice.start();
  return off.startRendering();
}

async function buildProtectedAudio(
  file: File, intensity: number, decoy: AudioBuffer | null, decoyGain: number,
  stereoCancel: number, noise: number
): Promise<AudioBuffer | null> {
  const decoded = await decodeFile(file);
  if (!decoded) return null;
  return renderProtected(decoded, { intensity, decoy, decoyGain, stereoCancel, noise });
}

/**
 * Public helper: builds the protected AudioBuffer (48 kHz) for a video file,
 * used by the creative pipeline when audio protection is enabled. All knobs
 * are 0–100; decoyFile is optional. Returns null if there's no decodable audio.
 */
export async function buildProtectedAudioBuffer(
  videoFile: File,
  opts: { intensity?: number; decoyFile?: File | null; decoyGain?: number; stereoCancel?: number; noise?: number }
): Promise<AudioBuffer | null> {
  const decoy = opts.decoyFile ? await decodeFile(opts.decoyFile) : null;
  return buildProtectedAudio(
    videoFile,
    (opts.intensity ?? 60) / 100,
    decoy,
    (opts.decoyGain ?? 75) / 100,
    (opts.stereoCancel ?? 0) / 100,
    (opts.noise ?? 0) / 100,
  );
}

// Encode an AudioBuffer to a 16-bit PCM WAV Blob (for <audio> preview).
function audioBufferToWav(buf: AudioBuffer): Blob {
  const numCh = Math.min(buf.numberOfChannels, 2);
  const sr = buf.sampleRate;
  const n = buf.length;
  const bytesPerSample = 2;
  const blockAlign = numCh * bytesPerSample;
  const dataSize = n * blockAlign;
  const ab = new ArrayBuffer(44 + dataSize);
  const dv = new DataView(ab);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); dv.setUint32(4, 36 + dataSize, true); ws(8, "WAVE");
  ws(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true);
  dv.setUint16(22, numCh, true); dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * blockAlign, true); dv.setUint16(32, blockAlign, true);
  dv.setUint16(34, 16, true); ws(36, "data"); dv.setUint32(40, dataSize, true);
  const chans: Float32Array[] = [];
  for (let c = 0; c < numCh; c++) chans.push(buf.getChannelData(c));
  let off = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < numCh; c++) {
      let v = chans[c][i];
      v = Math.max(-1, Math.min(1, v));
      dv.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([ab], { type: "audio/wav" });
}

/**
 * Renders a short preview (first `seconds`) of the protected audio at the
 * given intensity (0–100) and returns a playable WAV Blob.
 */
export async function previewProtectedAudio(
  file: File, intensity: number, seconds = 12,
  decoyFile?: File | null, decoyGain = 75, stereoCancel = 0, noise = 0
): Promise<Blob | null> {
  const decoded = await decodeFile(file);
  if (!decoded) return null;
  const trimCtx = new OfflineAudioContext(1, 1, decoded.sampleRate);
  const clip = trimBuffer(trimCtx, decoded, seconds);
  const decoy = decoyFile ? await decodeFile(decoyFile) : null;
  const rendered = await renderProtected(clip, {
    intensity: intensity / 100, decoy, decoyGain: decoyGain / 100,
    stereoCancel: stereoCancel / 100, noise: noise / 100,
  });
  return audioBufferToWav(rendered);
}

// ── Full pipeline: passthrough video + protected audio → MP4 ─────────────────
export async function protectVideoAudio(opts: AudioProtectOptions): Promise<Blob | null> {
  const { videoFile, onProgress, cancelRef } = opts;
  const intensity = (opts.intensity ?? 100) / 100;
  const decoyGain = (opts.decoyGain ?? 75) / 100;
  const stereoCancel = (opts.stereoCancel ?? 0) / 100;
  const noise = (opts.noise ?? 0) / 100;

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
  const decoy = (opts.decoyFile && audioCodecsAvailable()) ? await decodeFile(opts.decoyFile) : null;
  let audioBuf = audioCodecsAvailable() ? await buildProtectedAudio(videoFile, intensity, decoy, decoyGain, stereoCancel, noise) : null;
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
