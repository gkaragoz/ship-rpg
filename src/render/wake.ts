import * as THREE from 'three';
import type { Quality } from './quality';
import { MAX_STAMPS, type Stamp } from './wakeStamps';

/** Side (m) of the square of sea, centred on the camera, whose foam and ripples are kept. */
export const WAKE_AREA = 360;

/** Foam fades out with this rate (1/s), ripple height faster; both spread a little every frame. */
const FOAM_DECAY = 0.45;
const HEIGHT_DECAY = 1.6;
const SPREAD = 6;

const quadVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** Fade, spread and scroll the previous map: R is foam, G the ripple height (m). */
const stepFragment = /* glsl */ `
uniform sampler2D uPrev;
uniform vec2 uShift;
uniform float uTexel;
uniform float uFoamKeep;
uniform float uHeightKeep;
uniform float uSpread;
varying vec2 vUv;
vec4 prev(vec2 uv) {
  vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  return texture2D(uPrev, uv) * inside.x * inside.y;
}
void main() {
  vec2 uv = vUv + uShift;
  vec4 c = prev(uv);
  vec4 b = 0.25 * (prev(uv + vec2(uTexel, 0.0)) + prev(uv - vec2(uTexel, 0.0)) + prev(uv + vec2(0.0, uTexel)) + prev(uv - vec2(0.0, uTexel)));
  vec4 m = mix(c, b, uSpread);
  gl_FragColor = vec4(m.r * uFoamKeep, m.g * uHeightKeep, 0.0, 0.0);
}`;

const stampVertex = /* glsl */ `
attribute vec4 aA;
attribute vec4 aB;
uniform vec2 uOrigin;
uniform float uSize;
varying vec2 vLocal;
varying vec2 vAmount;
varying float vKind;
void main() {
  vec2 p = position.xy * 1.3;
  vLocal = p;
  vAmount = aB.zw;
  vKind = aA.w;
  vec2 fwd = vec2(cos(aA.z), -sin(aA.z));
  vec2 stb = vec2(sin(aA.z), cos(aA.z));
  vec2 world = aA.xy + fwd * (p.x * aB.x * 0.5) + stb * (p.y * aB.y * 0.5);
  gl_Position = vec4(((world - uOrigin) / uSize) * 2.0 - 1.0, 0.0, 1.0);
}`;

const stampFragment = /* glsl */ `
varying vec2 vLocal;
varying vec2 vAmount;
varying float vKind;
void main() {
  float r = length(vLocal);
  float blob = 1.0 - smoothstep(0.35, 1.0, r);
  float ring = smoothstep(0.55, 0.9, r) * (1.0 - smoothstep(0.95, 1.3, r));
  float shape = vKind < 0.5 ? blob : ring;
  gl_FragColor = vec4(vAmount.x * shape, vAmount.y * shape, 0.0, 0.0);
}`;

/** The foam and ripple map the sea shader reads: ships and splashes paint into it, time fades it. */
export interface Wake {
  /** R: foam, G: ripple height (m). A black dummy when the GPU cannot render to half floats. */
  readonly texture: THREE.Texture;
  /** World position of the map's corner, and its side (m). */
  readonly origin: THREE.Vector2;
  readonly size: number;
  readonly enabled: boolean;
  update(renderer: THREE.WebGLRenderer, dt: number, camera: THREE.Camera, stamps: readonly Stamp[]): void;
  setQuality(quality: Quality): void;
  dispose(): void;
}

const snap = (v: number, cell: number): number => Math.round(v / cell) * cell;

export function createWake(renderer: THREE.WebGLRenderer, quality: Quality): Wake {
  const gl2 = renderer.capabilities.isWebGL2;
  const enabled = gl2 && (renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
  const blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1);
  blank.needsUpdate = true;

  const make = (px: number): THREE.WebGLRenderTarget =>
    new THREE.WebGLRenderTarget(px, px, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
    });
  let px = quality.wake;
  let targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = enabled ? [make(px), make(px)] : null;
  let current = 0;
  const origin = new THREE.Vector2(0, 0);
  let primed = false;

  const stepMaterial = new THREE.ShaderMaterial({
    vertexShader: quadVertex,
    fragmentShader: stepFragment,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uPrev: { value: blank },
      uShift: { value: new THREE.Vector2() },
      uTexel: { value: 1 / px },
      uFoamKeep: { value: 1 },
      uHeightKeep: { value: 1 },
      uSpread: { value: 0 },
    },
  });
  const stepScene = new THREE.Scene();
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), stepMaterial);
  quad.frustumCulled = false;
  stepScene.add(quad);

  const base = new THREE.PlaneGeometry(2, 2);
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setIndex(base.getIndex());
  geometry.setAttribute('position', base.getAttribute('position'));
  const aA = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 4), 4);
  const aB = new THREE.InstancedBufferAttribute(new Float32Array(MAX_STAMPS * 4), 4);
  aA.setUsage(THREE.DynamicDrawUsage);
  aB.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aA', aA);
  geometry.setAttribute('aB', aB);
  const stampMaterial = new THREE.ShaderMaterial({
    vertexShader: stampVertex,
    fragmentShader: stampFragment,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneFactor,
    uniforms: { uOrigin: { value: origin }, uSize: { value: WAKE_AREA } },
  });
  const stampMesh = new THREE.Mesh(geometry, stampMaterial);
  stampMesh.frustumCulled = false;
  const stampScene = new THREE.Scene();
  stampScene.add(stampMesh);
  const ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); // unused: the shaders write clip space

  return {
    get texture(): THREE.Texture {
      return targets ? targets[current]!.texture : blank;
    },
    origin,
    size: WAKE_AREA,
    enabled,
    update(r, dt, camera, stamps): void {
      if (!targets) return;
      const texel = WAKE_AREA / px;
      const nx = snap(camera.position.x - WAKE_AREA / 2, texel);
      const nz = snap(camera.position.z - WAKE_AREA / 2, texel);
      const shift = stepMaterial.uniforms.uShift!.value as THREE.Vector2;
      shift.set(primed ? (nx - origin.x) / WAKE_AREA : 0, primed ? (nz - origin.y) / WAKE_AREA : 0);
      origin.set(nx, nz);
      primed = true;
      const u = stepMaterial.uniforms;
      u.uPrev!.value = targets[current]!.texture;
      u.uTexel!.value = 1 / px;
      u.uFoamKeep!.value = Math.exp(-FOAM_DECAY * dt);
      u.uHeightKeep!.value = Math.exp(-HEIGHT_DECAY * dt);
      u.uSpread!.value = Math.min(SPREAD * dt, 0.5);

      const n = Math.min(stamps.length, MAX_STAMPS);
      for (let i = 0; i < n; i++) {
        const s = stamps[i]!;
        aA.setXYZW(i, s.x, s.z, s.heading, s.kind);
        aB.setXYZW(i, s.length, s.width, s.foam, s.height);
      }
      aA.needsUpdate = true;
      aB.needsUpdate = true;
      geometry.instanceCount = n;

      const previous = r.getRenderTarget();
      const auto = r.autoClear;
      r.autoClear = false;
      const next = 1 - current;
      r.setRenderTarget(targets[next]!);
      r.render(stepScene, ortho);
      if (n > 0) r.render(stampScene, ortho);
      r.setRenderTarget(previous);
      r.autoClear = auto;
      current = next;
    },
    setQuality(q): void {
      if (!targets || q.wake === px) return;
      for (const t of targets) t.dispose();
      px = q.wake;
      targets = [make(px), make(px)];
      primed = false;
    },
    dispose(): void {
      targets?.forEach((t) => t.dispose());
      stepMaterial.dispose();
      stampMaterial.dispose();
      quad.geometry.dispose();
      geometry.dispose();
      base.dispose();
      blank.dispose();
    },
  };
}
