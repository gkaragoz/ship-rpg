import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/examples/jsm/postprocessing/SSAOPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import { createGpuTimer } from './gpuTimer';
import { SsgiPass } from './ssgiPass';
import type { AntialiasMode, GraphicsSettings, OcclusionMode, ToneMapping } from '../settings';
import type { Pass } from 'three/examples/jsm/postprocessing/Pass.js';

const TONE: Record<ToneMapping, THREE.ToneMapping> = {
  none: THREE.NoToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
};

/**
 * Objects on this layer are drawn for the eye but not into the occlusion pass's depth and normals: the sea (a
 * flat plane there, its waves are in the shader), the sky and the particle effects.
 */
const NOT_OCCLUDING = 1;

export function excludeFromOcclusion(root: THREE.Object3D): void {
  root.traverse((o) => o.layers.set(NOT_OCCLUDING));
}

/** Ambient occlusion is computed out to this distance (m); ships beyond it are not darkened at their contacts. */
const OCCLUSION_FAR = 500;

/** Multisample count of an antialiasing mode (0 for the ones that are not MSAA). */
export function msaaSamples(mode: AntialiasMode): number {
  return mode === 'msaa2' ? 2 : mode === 'msaa4' ? 4 : mode === 'msaa8' ? 8 : 0;
}

/**
 * Does the frame have to go through the post-processing chain at all? Only when something in it is switched on:
 * antialiasing, bloom, tone mapping, ambient occlusion or bounce light, or a render scale other than 1.
 */
export function needsComposer(g: GraphicsSettings): boolean {
  return g.antialias !== 'off' || g.bloom || g.toneMapping !== 'none' || g.renderScale !== 1 || effectiveOcclusion(g) !== 'off';
}

/** The occlusion pass that runs: screen-space bounce light needs GTAO's depth and normal buffers, so it brings GTAO with it. */
export function effectiveOcclusion(g: GraphicsSettings): OcclusionMode {
  return g.globalIllumination === 'ssgi' ? 'gtao' : g.ambientOcclusion;
}

/** The canvas pixel ratio: the display's, but never above 2 (more only costs fill rate). */
export const canvasRatio = (): number => Math.min(window.devicePixelRatio || 1, 2);

/**
 * The frame's way to the screen. The scene is drawn into a (multisampled, half-float) render target, then goes
 * through bloom, tone mapping (all objects, including the sea and sky shaders, are tone mapped together) and FXAA,
 * and the last pass writes the canvas. The render scale sets the target's size relative to the canvas.
 */
/** What the last frame cost, for the debug overlay and `?perf`. */
export interface RenderStats {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  /** Multisample count of the scene target (0: none) and whether it is half float. */
  samples: number;
  hdr: boolean;
  /** Whether the post-processing chain was used, the canvas size in pixels and the render scale. */
  composer: boolean;
  width: number;
  height: number;
  scale: number;
  /** GPU time of the frame in ms, when the browser offers a timer. */
  gpuMs: number | null;
}

export interface Pipeline {
  /** Wrap a whole frame (wake passes included): counters are reset and the GPU timer runs between the two. */
  beginFrame(): void;
  endFrame(): void;
  stats(): RenderStats;
  /** CSS size of the canvas. */
  setSize(width: number, height: number): void;
  apply(graphics: GraphicsSettings): void;
  render(): void;
  /** What the settings and the GPU came to: the multisample count in use and whether the target is half float. */
  readonly info: { samples: number; hdr: boolean; composer: boolean };
  dispose(): void;
}

export function createPipeline(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, initial: GraphicsSettings): Pipeline {
  camera.layers.enable(NOT_OCCLUDING); // the eye sees everything; the occlusion camera below only layer 0
  // One frame is several render calls (wake map, scene, post passes): count them all, and reset once per frame in `render()`'s caller.
  renderer.info.autoReset = false;
  // The scene is rendered more than once a frame (beauty pass, occlusion normals): draw the sun's shadow map once.
  renderer.shadowMap.autoUpdate = false;
  const gpu = createGpuTimer(renderer);
  const hdr = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
  const maxSamples = renderer.capabilities.maxSamples;
  const target = new THREE.WebGLRenderTarget(1, 1, { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, samples: 0 });
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.3, 0.55, 0.95);
  const output = new OutputPass();
  const fxaa = new ShaderPass(FXAAShader);
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(fxaa);

  // The occlusion passes draw the scene again for normals and depth, with a camera that skips the sea and sky.
  const aoCamera = new THREE.PerspectiveCamera();
  aoCamera.layers.set(0);
  let occlusion: { mode: Exclude<OcclusionMode, 'off'>; pass: Pass } | null = null;
  const syncAoCamera = (): void => {
    aoCamera.copy(camera);
    aoCamera.layers.set(0);
    aoCamera.far = OCCLUSION_FAR;
    aoCamera.updateProjectionMatrix();
    aoCamera.updateMatrixWorld(true);
  };
  let width = 1;
  let height = 1;
  let graphics = initial;
  let samples = 0;
  let useComposer = true;

  const layout = (): void => {
    const dpr = canvasRatio();
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height);
    const ratio = dpr * graphics.renderScale;
    composer.setPixelRatio(ratio);
    composer.setSize(width, height);
    const resolution = fxaa.material.uniforms.resolution?.value as THREE.Vector2 | undefined;
    resolution?.set(1 / (width * ratio), 1 / (height * ratio));
  };

  // Screen-space bounce light, drawn after the occlusion pass whose depth and normal buffers it reads.
  let ssgi: SsgiPass | null = null;
  const syncSsgi = (): void => {
    const gtao = occlusion?.mode === 'gtao' ? (occlusion.pass as GTAOPass) : null;
    const wanted = graphics.globalIllumination === 'ssgi' && gtao !== null;
    if (ssgi && (!wanted || ssgi.source !== gtao)) {
      composer.removePass(ssgi);
      ssgi.dispose();
      ssgi = null;
    }
    if (wanted && gtao && !ssgi) {
      const ratio = canvasRatio() * graphics.renderScale;
      ssgi = new SsgiPass(aoCamera, gtao, Math.round(width * ratio), Math.round(height * ratio));
      composer.insertPass(ssgi, composer.passes.indexOf(gtao) + 1);
    }
  };

  const setOcclusion = (mode: OcclusionMode): void => {
    if ((occlusion?.mode ?? 'off') === mode) return;
    if (occlusion) {
      composer.removePass(occlusion.pass);
      occlusion.pass.dispose();
      occlusion = null;
    }
    if (mode === 'off') return;
    syncAoCamera();
    const ratio = canvasRatio() * graphics.renderScale;
    const w = Math.max(1, Math.round(width * ratio));
    const h = Math.max(1, Math.round(height * ratio));
    let pass: Pass;
    if (mode === 'gtao') {
      const gtao = new GTAOPass(scene, aoCamera, w, h);
      gtao.updateGtaoMaterial({ radius: 1.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.1, samples: 12 });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 8 });
      pass = gtao;
    } else {
      const ssao = new SSAOPass(scene, aoCamera, w, h);
      ssao.kernelRadius = 3;
      ssao.minDistance = 0.0002;
      ssao.maxDistance = 4 / OCCLUSION_FAR;
      pass = ssao;
    }
    composer.insertPass(pass, 1); // right after the scene, before bloom and tone mapping
    occlusion = { mode, pass };
  };

  const apply = (g: GraphicsSettings): void => {
    const previous = graphics;
    graphics = g;
    renderer.toneMapping = TONE[g.toneMapping];
    renderer.toneMappingExposure = g.exposure;
    useComposer = needsComposer(g);
    const wanted = Math.min(msaaSamples(g.antialias), maxSamples);
    if (wanted !== samples) {
      samples = wanted;
      for (const rt of [composer.renderTarget1, composer.renderTarget2]) {
        rt.samples = samples;
        rt.dispose(); // reallocated with the new sample count on next use
      }
    }
    setOcclusion(effectiveOcclusion(g));
    syncSsgi();
    bloom.enabled = g.bloom;
    fxaa.enabled = g.antialias === 'fxaa';
    if (previous.renderScale !== g.renderScale) layout();
  };
  apply(initial);

  return {
    setSize(w, h): void {
      width = Math.max(1, w);
      height = Math.max(1, h);
      layout();
    },
    apply,
    beginFrame(): void {
      renderer.info.reset();
      gpu.begin();
    },
    endFrame(): void {
      gpu.end();
    },
    stats(): RenderStats {
      const info = renderer.info;
      return {
        calls: info.render.calls,
        triangles: info.render.triangles,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        samples,
        hdr,
        composer: useComposer,
        width: renderer.domElement.width,
        height: renderer.domElement.height,
        scale: graphics.renderScale,
        gpuMs: gpu.ms,
      };
    },
    render(): void {
      renderer.shadowMap.needsUpdate = true;
      if (occlusion) syncAoCamera();
      if (useComposer) composer.render();
      else renderer.render(scene, camera);
    },
    get info() {
      return { samples, hdr, composer: useComposer };
    },
    dispose(): void {
      gpu.dispose();
      composer.dispose();
      bloom.dispose();
      output.dispose();
      fxaa.dispose();
      renderPass.dispose();
      ssgi?.dispose();
      occlusion?.pass.dispose();
      target.dispose();
    },
  };
}
