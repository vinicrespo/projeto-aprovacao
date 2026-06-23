export interface ShaderUniforms {
  u_time: number;
  u_contrast_curve: number;
  u_chromatic_offset: number;
  u_motion_blur_weight: number;
  u_noise_density: number;
  u_noise_enabled: number;   // 1.0 = on, 0.0 = off
  u_flip_v: number;          // 1.0 = flip vertical
  u_flip_h: number;          // 1.0 = flip horizontal
}

export interface AnalysisResult {
  motionIntensity: number;
  luminanceHistogram: number[];
  artifactScore: number;
  recommendedProfile: ShaderUniforms;
}

export interface Preset {
  id: string;
  name: string;
  uniforms: ShaderUniforms;
  createdAt: number;
}

export interface DiagnosticInfo {
  fps: number;
  gpuMemoryMB: number;
  shaderErrors: string[];
  frameTimeMs: number;
}

export interface ProcessingState {
  status: "idle" | "analyzing" | "processing" | "exporting" | "done" | "error";
  progress: number;
  message: string;
}
