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
uniform float u_crackle_intensity; // 0 = off, 1 = full crackle

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

// --- Crackle / Craquelado (Worley/Voronoi cellular noise) ---
// Cell boundaries = cracks. The distance to the nearest cell point
// controls crack darkness: points closest to a boundary are darkest.

vec2 cellPoint(vec2 cell) {
  // Pseudo-random point inside each cell — seeded by cell coords
  return fract(sin(vec2(
    dot(cell, vec2(127.1, 311.7)),
    dot(cell, vec2(269.5, 183.3))
  )) * 43758.5453);
}

float worley(vec2 uv, float scale) {
  vec2 st = uv * scale;
  vec2 cell = floor(st);
  vec2 f    = fract(st);
  float minDist = 8.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 neighbor = vec2(float(x), float(y));
      vec2 pt = cellPoint(cell + neighbor);
      float d = length(neighbor + pt - f);
      minDist = min(minDist, d);
    }
  }
  return minDist;
}

// Multi-scale crackle: coarse cracks + fine cracks layered
float crackle(vec2 uv) {
  float c1 = worley(uv, 6.0);   // coarse cracks
  float c2 = worley(uv, 14.0);  // medium cracks
  float c3 = worley(uv, 28.0);  // fine cracks
  // Edge sharpness: pow drives thin, sharp crack lines
  float crack = pow(c1, 3.0) * 0.5
              + pow(c2, 4.0) * 0.35
              + pow(c3, 5.0) * 0.15;
  return crack;
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

float grainDither(vec2 uv, float density, float time) {
  vec2 pos = uv * 1024.0;
  float grain = noise(pos + time * 17.3) * 2.0 - 1.0;
  return grain * density * 0.04;
}

void main() {
  vec2 uv = v_texcoord;

  if (u_flip_v > 0.5) uv.y = 1.0 - uv.y;
  if (u_flip_h > 0.5) uv.x = 1.0 - uv.x;

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

  // 6. Craquelado overlay
  if (u_crackle_intensity > 0.001) {
    float crack = crackle(uv);
    // crack value near 0 = crack boundary → darken; near 1 = cell center → untouched
    // Remap: low crack distance = dark crack line
    float crackMask = smoothstep(0.0, 0.35, crack); // 0 at crack, 1 away from crack
    // Apply: darken crack lines, tint slightly warm (aged look)
    vec3 crackColor = vec3(0.18, 0.12, 0.08); // dark brownish crack
    float strength = u_crackle_intensity * 0.85;
    color = mix(mix(crackColor, color, crackMask), color, 1.0 - strength);
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
