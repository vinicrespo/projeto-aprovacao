import type { AnalysisResult, ShaderUniforms } from "@/types";

const SAMPLE_FRAMES = 30;
const STORAGE_KEY = "face_unds_analysis";

async function sampleFrame(
  video: HTMLVideoElement,
  canvas: OffscreenCanvas,
  ctx: OffscreenCanvasRenderingContext2D
): Promise<ImageData> {
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

function computeLuminanceHistogram(data: Uint8ClampedArray): number[] {
  const hist = new Array<number>(256).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    const lum = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    hist[lum]++;
  }
  const total = data.length / 4;
  return hist.map((v) => v / total);
}

function computeMotionDelta(prev: ImageData | null, curr: ImageData): number {
  if (!prev) return 0;
  let diff = 0;
  for (let i = 0; i < curr.data.length; i += 4) {
    diff += Math.abs(curr.data[i] - prev.data[i]);
    diff += Math.abs(curr.data[i + 1] - prev.data[i + 1]);
    diff += Math.abs(curr.data[i + 2] - prev.data[i + 2]);
  }
  return diff / (curr.data.length / 4 * 3 * 255);
}

// Crude DCT block artifact detection: looks for 8x8 boundary discontinuities
function computeArtifactScore(data: Uint8ClampedArray, w: number, h: number): number {
  let score = 0;
  let count = 0;
  for (let y = 8; y < h; y += 8) {
    for (let x = 0; x < w; x++) {
      const above = (((y - 1) * w + x) * 4);
      const curr  = ((y * w + x) * 4);
      score += Math.abs(data[curr] - data[above]);
      count++;
    }
  }
  return count > 0 ? Math.min(score / (count * 255), 1) : 0;
}

function buildRecommendedProfile(
  motionIntensity: number,
  luminanceHistogram: number[],
  artifactScore: number
): ShaderUniforms {
  // Underexposure: weight concentrated in low bins
  const lowBins = luminanceHistogram.slice(0, 64).reduce((a, b) => a + b, 0);
  const contrastBoost = lowBins > 0.5 ? 0.6 : 0.3;

  return {
    u_time: 0,
    u_contrast_curve: contrastBoost,
    u_chromatic_offset: 0.25,
    u_motion_blur_weight: Math.min(motionIntensity * 1.5, 0.6),
    u_noise_density: Math.min(artifactScore * 1.2, 0.8),
    u_noise_enabled: artifactScore > 0.1 ? 1 : 0,
    u_flip_v: 0,
    u_flip_h: 0,
  };
}

export async function analyzeVideo(
  video: HTMLVideoElement,
  onProgress?: (p: number) => void
): Promise<AnalysisResult> {
  const W = 320;
  const H = 180;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;

  const duration = video.duration;
  const interval = duration / SAMPLE_FRAMES;
  let prevFrame: ImageData | null = null;
  let totalMotion = 0;
  let combinedHist = new Array<number>(256).fill(0);
  let totalArtifact = 0;

  for (let i = 0; i < SAMPLE_FRAMES; i++) {
    video.currentTime = i * interval;
    await new Promise<void>((res) => {
      const handler = () => { video.removeEventListener("seeked", handler); res(); };
      video.addEventListener("seeked", handler);
    });

    const frame = await sampleFrame(video, canvas, ctx);
    const hist = computeLuminanceHistogram(frame.data);
    hist.forEach((v, idx) => { combinedHist[idx] += v / SAMPLE_FRAMES; });
    totalMotion += computeMotionDelta(prevFrame, frame);
    totalArtifact += computeArtifactScore(frame.data, W, H);
    prevFrame = frame;
    onProgress?.((i + 1) / SAMPLE_FRAMES);
  }

  const motionIntensity = totalMotion / SAMPLE_FRAMES;
  const artifactScore = totalArtifact / SAMPLE_FRAMES;
  const result: AnalysisResult = {
    motionIntensity,
    luminanceHistogram: combinedHist,
    artifactScore,
    recommendedProfile: buildRecommendedProfile(motionIntensity, combinedHist, artifactScore),
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(result));
  } catch {}

  return result;
}

export function loadCachedAnalysis(): AnalysisResult | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AnalysisResult) : null;
  } catch {
    return null;
  }
}
