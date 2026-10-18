import { readFileSync } from 'node:fs';
import type * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Load a shipped GLB into a three scene under node (no WebGL, no image decoding): the JSON chunk is rewritten
 * without textures, so geometry, names, vertex colours and UVs are the real ones.
 */
export async function loadGlbScene(rel: string): Promise<THREE.Group> {
  const data = readFileSync(new URL(`../public/models/${rel}`, import.meta.url));
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const jsonLen = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(data.subarray(20, 20 + jsonLen))) as Record<string, unknown>;
  delete json.images;
  delete json.textures;
  delete json.samplers;
  json.extensionsUsed = ((json.extensionsUsed as string[] | undefined) ?? []).filter((e) => e !== 'EXT_texture_webp');
  json.extensionsRequired = ((json.extensionsRequired as string[] | undefined) ?? []).filter((e) => e !== 'EXT_texture_webp');
  for (const m of (json.materials as Record<string, unknown>[] | undefined) ?? []) {
    delete m.normalTexture;
    delete m.occlusionTexture;
    delete m.emissiveTexture;
    const pbr = m.pbrMetallicRoughness as Record<string, unknown> | undefined;
    if (pbr) {
      delete pbr.baseColorTexture;
      delete pbr.metallicRoughnessTexture;
    }
  }
  const text = new TextEncoder().encode(JSON.stringify(json));
  const padded = new Uint8Array(Math.ceil(text.length / 4) * 4).fill(0x20);
  padded.set(text);
  const binStart = 20 + jsonLen;
  const bin = data.subarray(binStart);
  const out = new Uint8Array(12 + 8 + padded.length + bin.length);
  const ov = new DataView(out.buffer);
  ov.setUint32(0, 0x46546c67, true);
  ov.setUint32(4, 2, true);
  ov.setUint32(8, out.length, true);
  ov.setUint32(12, padded.length, true);
  ov.setUint32(16, 0x4e4f534a, true);
  out.set(padded, 20);
  out.set(bin, 20 + padded.length);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(out.buffer, '');
  return gltf.scene;
}
