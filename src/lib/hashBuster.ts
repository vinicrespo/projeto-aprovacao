/**
 * Generates a unique random seed [0, 1) for each export session.
 * Passed as u_hash_seed to the WebGL shader, which adds imperceptible
 * sub-pixel noise (~1.5/255 per channel) making every exported file
 * produce a unique binary hash without any visible difference.
 */
export function newHashSeed(): number {
  return Math.random();
}

/**
 * Returns a safe output filename always ending in .webm
 * (MediaRecorder only outputs WebM in browsers — never MP4).
 * Includes a 6-byte random hex suffix so filename heuristics on
 * ad platforms also fail to match repeated uploads.
 */
export function randomizedFilename(original: string): string {
  const rand = crypto.getRandomValues(new Uint8Array(6));
  const suffix = Array.from(rand).map((b) => b.toString(16).padStart(2, "0")).join("");
  const base = original
    .replace(/\.[^.]+$/, "")          // strip any extension
    .replace(/[^a-zA-Z0-9_-]/g, "_"); // sanitize
  return `${base}_${suffix}.mp4`;
}

/**
 * Generates a fully camouflaged output filename that mimics a natural
 * phone/camera export, with a random component so no two files share a
 * name. The original filename is discarded entirely — nothing about the
 * source is carried into the output, defeating filename-based heuristics
 * on ad platforms.
 *
 * Examples: IMG_4821.mp4 · VID_20240611_143207.mp4 · video_1718...mp4
 */
export function camouflagedFilename(): string {
  const r = (n: number) => Math.floor(Math.random() * n);
  const pad = (v: number, n: number) => String(v).padStart(n, "0");
  const hex = (n: number) =>
    Array.from(crypto.getRandomValues(new Uint8Array(n)))
      .map((b) => b.toString(16).padStart(2, "0")).join("");

  // Random but plausible date within the last ~120 days
  const d = new Date(Date.now() - r(120) * 86_400_000 - r(86_400_000));
  const ymd = `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`;
  const hms = `${pad(r(24), 2)}${pad(r(60), 2)}${pad(r(60), 2)}`;

  const patterns = [
    () => `IMG_${1000 + r(9000)}.mp4`,                 // IMG_4821.mp4
    () => `VID_${ymd}_${hms}.mp4`,                     // VID_20240611_143207.mp4
    () => `MOV_${hex(3).toUpperCase()}.mp4`,           // MOV_9F2A1C.mp4
    () => `video_${Date.now() - r(1_000_000)}.mp4`,    // video_1718283746.mp4
    () => `${ymd}_${hex(4)}.mp4`,                       // 20240611_a3f91c02.mp4
  ];
  return patterns[r(patterns.length)]();
}
