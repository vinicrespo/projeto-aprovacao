/**
 * Generates a unique random seed [0, 1) for each export session.
 * This seed is passed as u_hash_seed to the WebGL shader, which adds
 * imperceptible sub-pixel noise (~0.4/255 luminance variation) that
 * changes every pixel's binary value enough to produce a unique file hash
 * while remaining visually indistinguishable from the original.
 */
export function newHashSeed(): number {
  return Math.random();
}

/**
 * Rewrites the WebM/MP4 blob with a randomized sequence of padding bytes
 * injected into a private metadata region, guaranteeing a unique MD5/SHA
 * even if two exports used identical source material and settings.
 *
 * Strategy: append a custom EBML Void element (tag 0xEC) at the end of
 * the file containing 64 random bytes — ignored by all players but changes
 * the file hash completely.
 */
export async function injectHashNoise(blob: Blob): Promise<Blob> {
  const original = new Uint8Array(await blob.arrayBuffer());

  // 64 random bytes wrapped in an EBML Void element (0xEC, size=0x40)
  const noise = crypto.getRandomValues(new Uint8Array(64));
  const voidTag = new Uint8Array(3 + noise.length);
  voidTag[0] = 0xEC;  // EBML Void element ID
  voidTag[1] = 0x40;  // VINT size high byte
  voidTag[2] = 0x40;  // VINT size low byte = 64
  voidTag.set(noise, 3);

  const combined = new Uint8Array(original.length + voidTag.length);
  combined.set(original);
  combined.set(voidTag, original.length);

  return new Blob([combined], { type: blob.type });
}

/**
 * Generates a randomized output filename so repeated uploads to ad platforms
 * don't match on filename heuristics either.
 */
export function randomizedFilename(original: string): string {
  const ext = original.includes(".") ? original.split(".").pop() : "webm";
  const rand = crypto.getRandomValues(new Uint8Array(6));
  const suffix = Array.from(rand).map((b) => b.toString(16).padStart(2, "0")).join("");
  const base = original.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${base}_${suffix}.${ext}`;
}
