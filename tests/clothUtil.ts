import * as THREE from 'three';

/** Run a patched material's `onBeforeCompile` on a fake shader and return the uniform objects it hands to the GPU. */
export function uniformsOf(material: THREE.Material, vertexShader = THREE.ShaderLib.standard.vertexShader): Record<string, THREE.IUniform> {
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, vertexShader };
  material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
  return shader.uniforms;
}

/** Meshes under `root` whose name matches. */
export function meshesNamed(root: THREE.Object3D, re: RegExp): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && re.test(o.name)) out.push(o);
  });
  return out;
}

/** True when the material was patched with the cloth shader (it has its own `onBeforeCompile`). */
export const isCloth = (m: THREE.Material | THREE.Material[]): boolean =>
  !Array.isArray(m) && Object.prototype.hasOwnProperty.call(m, 'onBeforeCompile') && typeof m.customProgramCacheKey === 'function' && m.customProgramCacheKey().startsWith('cloth-');

/** The uniforms of the first cloth-patched sail material of a ship (procedural or GLB). */
export function shipClothUniforms(root: THREE.Object3D): Record<string, THREE.IUniform> {
  let found: THREE.Material | undefined;
  root.traverse((o) => {
    if (found || !(o instanceof THREE.Mesh) || !o.geometry.getAttribute('clothA')) return;
    if (isCloth(o.material as THREE.Material)) found = o.material as THREE.Material;
  });
  if (!found) throw new Error('no cloth material on this ship');
  return uniformsOf(found);
}
