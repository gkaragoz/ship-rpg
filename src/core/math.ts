export const clamp = (v: number, min: number, max: number): number => Math.min(Math.max(v, min), max);

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Wrap an angle in radians to [-π, π]. */
export function wrapAngle(a: number): number {
  const tau = Math.PI * 2;
  const r = (((a + Math.PI) % tau) + tau) % tau;
  return r - Math.PI;
}

/** Signed shortest rotation from `b` to `a` in radians, in [-π, π]. */
export const angleDiff = (a: number, b: number): number => wrapAngle(a - b);
