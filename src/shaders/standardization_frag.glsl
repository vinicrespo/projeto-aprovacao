#version 300 es
precision highp float;

uniform sampler2D u_texture;
uniform sampler2D u_prev_texture;
uniform float u_time;
uniform float u_contrast_curve;
uniform float u_chromatic_offset;
uniform float u_motion_blur_weight;
uniform float u_noise_density;
uniform float u_noise_enabled;
uniform float u_flip_v;
uniform float u_flip_h;
uniform float u_hash_seed;
uniform float u_crackle_intensity; // crackle intensity: 0 = off, 1 = visible cracks

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

float contrastCurve(float v, float strength) {
  float s = 0.5 + strength * 0.5;
  return clamp((v - 0.5) * (1.0 + s) + 0.5, 0.0, 1.0);
}

float toLinear(float c) {
  return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4);
}
float toSRGB(float c) {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * pow(c, 1.0 / 2.4) - 0.055;
}
vec3 linearToSRGB(vec3 c) { return vec3(toSRGB(c.r), toSRGB(c.g), toSRGB(c.b)); }
vec3 sRGBToLinear(vec3 c) { return vec3(toLinear(c.r), toLinear(c.g), toLinear(c.b)); }

vec3 chromaticAberration(sampler2D tex, vec2 uv, float offset) {
  vec2 dir = (uv - 0.5) * offset * 0.02;
  float r = texture(tex, uv + dir).r;
  float g = texture(tex, uv).g;
  float b = texture(tex, uv - dir).b;
  return vec3(r, g, b);
}

vec3 temporalBlend(vec3 current, vec2 uv, float weight) {
  vec3 prev = texture(u_prev_texture, uv).rgb;
  return mix(current, prev, clamp(weight, 0.0, 0.65));
}

// Worley noise — distance to nearest cell point (0 at boundary, ~1 at center)
vec2 cellPt(vec2 cell) {
  return fract(sin(vec2(dot(cell, vec2(127.1,311.7)), dot(cell, vec2(269.5,183.3)))) * 43758.5453);
}
float worley(vec2 uv, float scale) {
  vec2 st = uv * scale;
  vec2 ci = floor(st);
  vec2 cf = fract(st);
  float d = 8.0;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 nb = vec2(float(x), float(y));
      d = min(d, length(nb + cellPt(ci + nb) - cf));
    }
  return d;
}

float grainDither(vec2 uv, float density, float time) {
  vec2 pos = uv * 1024.0;
  float grain = noise(pos + time * 17.3) * 2.0 - 1.0;
  return grain * density * 0.04;
}

void main() {
  vec2 uv = v_texcoord;

  if (u_flip_v > 0.5) uv.y = 1.0 - uv.y;
  if (u_flip_h > 0.5) uv.x = 1.0 - uv.x;

  // (pixelation removed — crackle overlay applied after color processing)

  // 1. Chromatic correction
  vec3 color = chromaticAberration(u_texture, uv, u_chromatic_offset);

  // 2. Linear space processing
  color = sRGBToLinear(color);

  // 3. Contrast curve
  color.r = contrastCurve(color.r, u_contrast_curve);
  color.g = contrastCurve(color.g, u_contrast_curve);
  color.b = contrastCurve(color.b, u_contrast_curve);

  // 4. Back to sRGB
  color = linearToSRGB(color);

  // 5. Temporal smoothing (video only — images have weight=0)
  color = temporalBlend(color, uv, u_motion_blur_weight);

  // 6. Craquelado — thin dark lines at Voronoi cell boundaries
  if (u_crackle_intensity > 0.001) {
    // Multi-scale: large + medium cracks layered
    float d1 = worley(uv, 5.0);   // large cracks
    float d2 = worley(uv, 12.0);  // fine cracks
    // Very narrow smoothstep → only pixels right on the boundary darken
    float line1 = 1.0 - smoothstep(0.0, 0.06, d1);
    float line2 = 1.0 - smoothstep(0.0, 0.04, d2);
    float crack = clamp(line1 * 0.7 + line2 * 0.3, 0.0, 1.0);
    // Subtle darkening only — image stays fully legible
    color *= 1.0 - crack * u_crackle_intensity * 0.6;
  }

  // 7. Procedural grain dither
  float grain = grainDither(uv, u_noise_density, u_time) * u_noise_enabled;
  color += grain;

  // 8. Hash-bust noise
  vec2 hashUV = uv + vec2(u_hash_seed * 7.3, u_hash_seed * 3.7);
  float hashNoise = (noise(hashUV * 2048.0 + u_hash_seed * 100.0) * 2.0 - 1.0) * (1.5 / 255.0);
  color += hashNoise;

  fragColor = vec4(clamp(color, 0.0, 1.0), 1.0);
}
