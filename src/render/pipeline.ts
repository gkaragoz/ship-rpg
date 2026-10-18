import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { FXAAShader } from 'three/examples/jsm/shaders/FXAAShader.js';
import type { AntialiasMode, GraphicsSettings, ToneMapping } from '../settings';

const TONE: Record<ToneMapping, THREE.ToneMapping> = {
  none: THREE.NoToneMapping,
  aces: THREE.ACESFilmicToneMapping,
  agx: THREE.AgXToneMapping,
};

/** Multisample count of an antialiasing mode (0 for the ones that are not MSAA). */
export function msaaSamples(mode: AntialiasMode): number {
  return mode === 'msaa2' ? 2 : mode === 'msaa4' ? 4 : mode === 'msaa8' ? 8 : 0;
}

/**
 * Does the frame have to go through the post-processing chain at all? Only when something in it is switched on:
 * antialiasing, bloom, tone mapping or a render scale other than 1.
 */
export function needsComposer(g: GraphicsSettings): boolean {
  return g.antialias !== 'off' || g.bloom || g.toneMapping !== 'none' || g.renderScale !== 1;
}

/** The canvas pixel ratio: the display's, but never above 2 (more only costs fill rate). */
export const canvasRatio = (): number => Math.min(window.devicePixelRatio || 1, 2);

/**
 * The frame's way to the screen. The scene is drawn into a (multisampled, half-float) render target, then goes
 * through bloom, tone mapping (all objects, including the sea and sky shaders, are tone mapped together) and FXAA,
 * and the last pass writes the canvas. The render scale sets the target's size relative to the canvas.
 */
export interface Pipeline {
  /** CSS size of the canvas. */
  setSize(width: number, height: number): void;
  apply(graphics: GraphicsSettings): void;
  render(): void;
  /** What the settings and the GPU came to: the multisample count in use and whether the target is half float. */
  readonly info: { samples: number; hdr: boolean; composer: boolean };
  dispose(): void;
}

export function createPipeline(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, initial: GraphicsSettings): Pipeline {
  // One frame is several render calls (wake map, scene, post passes): count them all, and reset once per frame in `render()`'s caller.
  renderer.info.autoReset = false;
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
    render(): void {
      if (useComposer) composer.render();
      else renderer.render(scene, camera);
    },
    get info() {
      return { samples, hdr, composer: useComposer };
    },
    dispose(): void {
      composer.dispose();
      bloom.dispose();
      output.dispose();
      fxaa.dispose();
      renderPass.dispose();
      target.dispose();
    },
  };
}
