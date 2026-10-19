import { WAVE_COUNT } from './waves';

/**
 * The sea's pixel shader. A stylised but rich look: smooth analytic wave normals plus two scrolling detail
 * layers, wrapped diffuse, fresnel sky reflection, sun glitter, light glowing through thin crests, depth
 * tint and shore foam from the baked sea-floor texture, and whitecaps where the surface pinches
 * (Jacobian) that thicken with the sea state, plus wind streaks in a big sea.
 */
export const fragmentShader = /* glsl */ `
uniform vec3 uSun;
uniform vec3 uSunColor;
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uHorizon;
uniform vec3 uZenith;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTime;
uniform float uAmp;
uniform float uSea;
uniform float uRain;
uniform vec2 uDirs[${WAVE_COUNT}];
uniform sampler2D uTerrain;
uniform sampler2D uNoise;
uniform sampler2D uWake;
uniform vec2 uWakeOrigin;
uniform float uWakeSize;
uniform float uWakeTexel;
uniform float uWakeOn;
uniform vec2 uTerrainMin;
uniform vec2 uTerrainSize;
uniform vec2 uTerrainScale;
varying vec3 vWorld;
varying float vHeight;
varying vec3 vNormal;
varying float vJac;

vec3 skyAt(vec3 d) {
  float up = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uHorizon, uZenith, pow(up, 0.55));
  float s = clamp(dot(d, uSun), 0.0, 1.0);
  c += uSunColor * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.18) * (1.0 - uSea * 0.75);
  return c;
}

void main() {
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 v = toCam / dist;
  vec2 wd = uDirs[0];

  // Two drifting detail layers tilt the smooth wave normal; they fade a little with distance.
  vec4 n1 = texture2D(uNoise, vWorld.xz / 13.0 - wd * uTime * 0.045);
  vec4 n2 = texture2D(uNoise, mat2(0.8, 0.6, -0.6, 0.8) * vWorld.xz / 4.3 + vec2(wd.y, -wd.x) * uTime * 0.07 + 0.37);
  float detail = (0.3 + 0.9 * uSea) * (0.4 + 0.6 * (1.0 - smoothstep(150.0, 1000.0, dist)));
  vec2 tilt = ((n1.gb - 0.5) + 0.7 * (n2.gb - 0.5)) * detail;
  // Foam and ripples left by ships and splashes (R foam, G height), fading out at the edge of the map.
  vec2 wuv = (vWorld.xz - uWakeOrigin) / uWakeSize;
  float wedge = smoothstep(0.0, 0.05, min(min(wuv.x, wuv.y), min(1.0 - wuv.x, 1.0 - wuv.y))) * uWakeOn;
  vec4 wk = texture2D(uWake, wuv) * wedge;
  tilt += vec2(texture2D(uWake, wuv + vec2(uWakeTexel, 0.0)).g - texture2D(uWake, wuv - vec2(uWakeTexel, 0.0)).g, texture2D(uWake, wuv + vec2(0.0, uWakeTexel)).g - texture2D(uWake, wuv - vec2(0.0, uWakeTexel)).g) * 5.0 * wedge;
  // Far away the coarse clip-map rings sample the waves too sparsely: their normals and crest heights band in rings, so both relax to the calm mean.
  float far = smoothstep(350.0, 1800.0, dist);
  vec3 n = normalize(mix(vNormal, vec3(0.0, 1.0, 0.0), far * 0.75) + vec3(tilt.x, 0.0, tilt.y));

  float wrap = clamp(dot(n, uSun) * 0.5 + 0.5, 0.0, 1.0);
  float diff = wrap * wrap;
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float fres = clamp(0.03 + 0.97 * pow(1.0 - ndv, 4.0), 0.0, 1.0);
  float h01 = mix(clamp(0.5 + vHeight / (uAmp * 1.6), 0.0, 1.0), 0.5, far * 0.8);

  vec3 col = mix(uDeep, uShallow, h01) * (0.45 + 0.75 * diff);
  // Light shining through the thin top of a wave towards the viewer.
  float glow = pow(clamp(dot(v, -normalize(uSun + n * 0.25)), 0.0, 1.0), 3.0) * smoothstep(0.35, 0.9, h01);
  col += vec3(0.05, 0.55, 0.5) * glow * 0.45 * (1.0 - uSea * 0.5);

  // Water depth from the baked terrain texture: lagoon tint in the shallows.
  // The baked texture has texels of several metres, so its bilinear ramps show as flat facets: the lookup is warped and the depth roughened with the noise.
  vec2 uv = (vWorld.xz + (n1.rg - 0.5) * 7.0 + (n2.rg - 0.5) * 2.5 - uTerrainMin) / uTerrainSize;
  float ground = texture2D(uTerrain, uv).r * uTerrainScale.y + uTerrainScale.x + (n2.b - 0.5) * 0.9;
  float depth = max(-ground, 0.0);
  float shallow = 1.0 - smoothstep(0.0, 11.0, depth);
  shallow *= shallow * (3.0 - 2.0 * shallow);
  col = mix(col, vec3(0.30, 0.80, 0.74) * (0.7 + 0.5 * diff), shallow * 0.75);

  vec3 refl = reflect(-v, n);
  refl.y = abs(refl.y);
  col = mix(col, skyAt(refl), fres * 0.9);

  // Foam: pinched crests (more of it in a big sea), wind streaks, and the shore. The edges are lacy: a warped,
  // two-scale bubble noise decides where the foam holds, so patches break up and drift instead of tracing the crest.
  vec2 warp = (texture2D(uNoise, vWorld.xz / 23.0 + vec2(uTime * 0.012, -uTime * 0.008)).rg - 0.5) * 7.0;
  vec2 fp = vWorld.xz + warp;
  float breakup = 0.5 * (texture2D(uNoise, fp / 6.0 + vec2(uTime * 0.02, 0.0)).r + texture2D(uNoise, fp / 2.1 - vec2(0.0, uTime * 0.03)).r);
  float bubbles = texture2D(uNoise, fp / 0.9 + vec2(uTime * 0.05, uTime * 0.02)).g;
  float lace = 0.55 * breakup + 0.45 * bubbles;
  float seaF = smoothstep(0.1, 0.7, uSea);
  float pinch = smoothstep(0.6, 0.22, vJac);
  float cover = pinch * (0.5 + 1.5 * smoothstep(0.4, 0.9, h01)) * seaF * 1.3;
  float caps = smoothstep(0.3, 0.7, cover * (0.5 + 0.9 * lace) - (1.0 - lace) * 0.3);
  // long streaks along the wind, torn into rafts by the same noise, thickening to a white-out in a storm
  vec2 sp = vec2(dot(fp, wd) / 38.0, dot(fp, vec2(-wd.y, wd.x)) / 3.2);
  float raft = smoothstep(0.58, 0.9, texture2D(uNoise, sp - vec2(uTime * 0.01, 0.0)).r) * smoothstep(0.3, 0.75, lace + 0.15);
  float streak = raft * smoothstep(0.5, 0.95, uSea) * smoothstep(0.25, 0.7, h01) * 0.55;
  float pulse = 0.5 + 0.5 * sin(depth * 3.0 - uTime * 1.3 + breakup * 4.0);
  float shore = (1.0 - smoothstep(0.2 + 0.5 * breakup, 1.8, depth)) * (0.55 + 0.45 * pulse);
  float shade = clamp(wk.b, 0.0, 1.0); // a ship's shadow on the water
  col *= 1.0 - 0.5 * shade;
  float trail = clamp(wk.r * 1.15 - (1.0 - lace) * 0.4, 0.0, 1.0);
  // rain pocks the surface: tiny bright rings and a dulling of the glitter
  vec2 dp = vWorld.xz * 1.6 + vec2(0.0, uTime * 0.0);
  vec2 cell = floor(dp);
  vec2 rnd = texture2D(uNoise, cell / 61.0 + 0.37).rg;
  float pick = fract(rnd.x * 7.31 + rnd.y * 3.17);
  float phase = fract(uTime * (0.7 + 0.8 * rnd.y) + rnd.x * 5.0);
  vec2 centre = 0.5 + (vec2(rnd.y, pick) - 0.5) * 0.5;
  float ringR = length(fract(dp) - centre) * 2.0;
  float drop = smoothstep(0.1, 0.0, abs(ringR - phase * 0.7)) * (1.0 - phase) * step(pick, uRain * 0.22) * (1.0 - smoothstep(40.0, 120.0, dist));
  float white = clamp(max(max(max(caps, streak), shore), trail) + drop * 0.35, 0.0, 1.0);
  col = mix(col, mix(vec3(0.78, 0.88, 0.91), vec3(1.0), diff), white * 0.9);

  // Sun glitter on the facets that face it, broader and weaker as the sea gets rough.
  float spec = pow(clamp(dot(n, normalize(uSun + v)), 0.0, 1.0), mix(220.0, 70.0, uSea));
  col += uSunColor * spec * (0.6 + 0.8 * n2.r) * mix(1.2, 0.5, uSea) * (1.0 - white) * (1.0 - shade) * (1.0 - 0.6 * uRain);

  col = mix(col, uHorizon, smoothstep(uFogNear, uFogFar, dist));
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;
