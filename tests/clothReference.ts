import type * as THREE from 'three';

/**
 * CPU mirror of the position part of `clothDeform` in `src/ships/clothShader.ts` (furl, gather, tear, corner shrink and
 * the jib haul-down; no belly, flutter or folds; `clothReference.test.ts` pins the GLSL expressions it copies). Tests use it to see which vertices the shader would move.
 */
export function gatheredXY(geometry: THREE.BufferGeometry, v: number, furl: number, tear = 0): [number, number] {
  const A = geometry.getAttribute('clothA');
  const B = geometry.getAttribute('clothB');
  const C = geometry.getAttribute('clothC');
  const pos = geometry.getAttribute('position');
  const x0 = pos.getX(v);
  const y0 = pos.getY(v);
  const code = A.getX(v);
  if (code < 0.5) return [x0, y0];
  const slot = code % 10;
  const rigid = code >= 10;
  const clamp01 = (t: number): number => Math.min(Math.max(t, 0), 1);
  const smooth = (a: number, b: number, t: number): number => {
    const k = clamp01((t - a) / (b - a));
    return k * k * (3 - 2 * k);
  };
  if (slot > 4.5) {
    const g = Math.min(Math.max(furl * 0.93, 0), 0.96);
    return [B.getX(v) + (x0 - B.getX(v)) * (1 - g), B.getY(v) + (y0 - B.getY(v)) * (1 - g)];
  }
  const aft = slot > 3.5;
  const yTop = B.getX(v);
  const H = Math.max(B.getY(v), 0.05);
  const u = A.getZ(v);
  const d = Math.max(yTop - y0, 0);
  const g = Math.min(Math.max(furl * 0.93 * (1 + 0.22 * Math.abs(2 * u - 1)), 0), 0.96);
  const t = tear * 0.35 * smooth(0.1, 1, 1 - A.getY(v));
  const keep = (1 - g) * (1 - t);
  const margin = rigid ? Math.min(0.25, 0.08 * H) : 0;
  const d2 = d <= margin ? d : margin + (d - margin) * keep;
  let x = x0;
  let y = y0 + (yTop - y0 > 0 ? d - d2 : 0);
  const tip = aft && !rigid ? 1 - C.getW(v) : 0;
  if (tip > 0) {
    const sx = C.getX(v) + (x0 - C.getX(v)) * (1 - 0.93 * g);
    const sy = C.getY(v) + (y0 - C.getY(v)) * (1 - 0.93 * g);
    x = x * (1 - tip) + sx * tip;
    y = y * (1 - tip) + sy * tip;
  }
  return [x, y];
}
