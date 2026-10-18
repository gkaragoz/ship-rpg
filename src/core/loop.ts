import { CONFIG } from './config';

export interface LoopHandlers {
  /** Fixed-step simulation update (seconds). */
  update(dt: number): void;
  /** Per-frame render; `alpha` is interpolation factor 0..1. */
  render(alpha: number): void;
}

/** Fixed-timestep game loop. Returns a stop function. */
export function startLoop(handlers: LoopHandlers): () => void {
  let last = performance.now();
  let acc = 0;
  let raf = 0;
  const frame = (now: number): void => {
    const delta = Math.min((now - last) / 1000, CONFIG.maxFrameDelta);
    last = now;
    acc += delta;
    while (acc >= CONFIG.fixedStep) {
      handlers.update(CONFIG.fixedStep);
      acc -= CONFIG.fixedStep;
    }
    handlers.render(acc / CONFIG.fixedStep);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
