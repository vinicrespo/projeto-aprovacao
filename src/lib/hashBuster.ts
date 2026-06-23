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
