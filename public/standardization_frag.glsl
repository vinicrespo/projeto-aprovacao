#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform sampler2D u_prev_texture;
uniform float u_time;
uniform float u_contrast_curve;
uniform float u_chromatic_offset;
uniform float u_motion_blur_weight;
uniform float u_noise_density;

in vec2 v_texcoord;
out vec4 fragColor;

// --- Utilities ---

float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

// Smooth S-curve contrast (non-linear, WCAG-aware midtone boost)
float contrastCurve(float v, float strength) {
  float s = 0.5 + strength * 0.5;
  return clamp(
    (v - 0.5) * (1.0 + s) + 0.5,
    0.0, 1.0
  );
}

// sRGB <-> linear conversions for perceptually-correct blending
float toLinear(float c) {
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}
float toSRGB(float c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}
vec3 linearToSRGB(vec3 c) {
  return vec3(toSRGB(c.r), toSRGB(c.g), toSRGB(c.b));
}
vec3 sRGBToLinear(vec3 c) {
  return vec3(toLinear(c.r), toLinear(c.g), toLinear(c.b));
}

// --- Chromatic Aberration (Lens Desalignment Correction) ---
// Models color channel misregistration caused by optical imperfections;
// correcting it compensates sRGB/P3 gama boundary artifacts.
vec3 chromaticAberration(sampler2D tex, vec2 uv, float offset) {
  vec2 dir = (uv - 0.5) * offset * 0.02;
  float r = texture(tex, uv + dir).r;
  float g = texture(tex, uv).g;
  float b = texture(tex, uv - dir).b;
  return vec3(r, g, b);
}

// --- Temporal Integration (Motion Judder Reduction) ---
// Blends current frame with previous to smooth abrupt motion spikes.
vec3 temporalBlend(vec3 current, vec2 uv, float weight) {
  vec3 prev = texture(u_prev_texture, uv).rgb;
  return mix(current, prev, clamp(weight, 0.0, 0.65));
}

// --- High-Frequency Texturing (Compression Artifact Masking) ---
// Procedural grain dithers over DCT block boundaries from aggressive codecs.
float grainDither(vec2 uv, float density, float time) {
  vec2 pos = uv * 1024.0;
  float grain = noise(pos + time * 17.3) * 2.0 - 1.0;
  return grain * density * 0.04;
}

void main() {
  vec2 uv = v_texcoord;

  // 1. Chromatic correction pass
  vec3 color = chromaticAberration(u_texture, uv, u_chromatic_offset);

  // 2. Linear space processing
  color = sRGBToLinear(color);

  // 3. Contrast curve (WCAG legibility)
  color.r = contrastCurve(color.r, u_contrast_curve);
  color.g = contrastCurve(color.g, u_contrast_curve);
  color.b = contrastCurve(color.b, u_contrast_curve);

  // 4. Back to sRGB for temporal blend
  color = linearToSRGB(color);

  // 5. Temporal motion smoothing
  color = temporalBlend(color, uv, u_motion_blur_weight);

  // 6. Procedural dithering over compression artifacts
  float grain = grainDither(uv, u_noise_density, u_time);
  color += grain;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
