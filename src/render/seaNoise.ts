import * as THREE from 'three';

const SIZE = 256;

/** Deterministic hash of an integer lattice point to 0…1. */
function hash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

/** Value noise with a lattice that wraps every `period` cells, so the result tiles. */
function tileNoise(x: number, y: number, period: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const fx = x - xi;
  const fy = y - yi;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const at = (i: number, j: number): number => hash(((i % period) + period) % period, ((j % period) + period) % period);
  const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
  const bottom = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
  return top + (bottom - top) * sy;
}

/** Height field of a tiling fractal noise, 0…1, `size × size`. */
export function noiseField(size = SIZE): Float32Array {
  const field = new Float32Array(size * size);
  const octaves = [
    { period: 8, weight: 0.5 },
    { period: 16, weight: 0.3 },
    { period: 32, weight: 0.15 },
    { period: 64, weight: 0.05 },
  ];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let h = 0;
      for (const o of octaves) h += o.weight * tileNoise((i / size) * o.period, (j / size) * o.period, o.period);
      field[j * size + i] = h;
    }
  }
  return field;
}

/**
 * The sea's detail texture: R = noise height, G and B = its slope in x and y (0.5 = flat), tiling and
 * mip-mapped. The shader scrolls two scales of it for fine ripples, foam breakup and wind streaks.
 */
export function bakeSeaNoise(size = SIZE): THREE.DataTexture {
  const h = noiseField(size);
  const at = (i: number, j: number): number => h[((j + size) % size) * size + ((i + size) % size)] ?? 0;
  const data = new Uint8Array(size * size * 4);
  let max = 1e-6;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) max = Math.max(max, Math.abs(at(i + 1, j) - at(i - 1, j)), Math.abs(at(i, j + 1) - at(i, j - 1)));
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const k = (j * size + i) * 4;
      data[k] = Math.round(at(i, j) * 255);
      data[k + 1] = Math.round((0.5 + (0.5 * (at(i + 1, j) - at(i - 1, j))) / max) * 255);
      data[k + 2] = Math.round((0.5 + (0.5 * (at(i, j + 1) - at(i, j - 1))) / max) * 255);
      data[k + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
