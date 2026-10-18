import type * as THREE from 'three';

/**
 * How long the GPU takes to draw a frame, from `EXT_disjoint_timer_query_webgl2` where the browser offers it
 * (many hide it). `begin()` and `end()` wrap one frame; results arrive a few frames later and are averaged.
 */
export interface GpuTimer {
  begin(): void;
  end(): void;
  /** Smoothed GPU time of a frame in ms, or null when the timer is not available (or nothing has come back yet). */
  readonly ms: number | null;
  dispose(): void;
}

const MAX_PENDING = 6;
const SMOOTHING = 0.15;

export function createGpuTimer(renderer: THREE.WebGLRenderer): GpuTimer {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const ext = renderer.capabilities.isWebGL2 ? (gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null) : null;
  const pending: WebGLQuery[] = [];
  let active: WebGLQuery | null = null;
  let ms: number | null = null;

  const collect = (): void => {
    while (pending.length > 0) {
      const query = pending[0]!;
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
      const disjoint = ext ? (gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean) : false;
      const nanoseconds = gl.getQueryParameter(query, gl.QUERY_RESULT) as number;
      gl.deleteQuery(query);
      pending.shift();
      if (!disjoint) {
        const value = nanoseconds / 1e6;
        ms = ms === null ? value : ms + (value - ms) * SMOOTHING;
      }
    }
  };

  return {
    begin(): void {
      if (!ext || active || pending.length >= MAX_PENDING) return;
      collect();
      active = gl.createQuery();
      if (active) gl.beginQuery(ext.TIME_ELAPSED_EXT, active);
    },
    end(): void {
      if (!ext || !active) return;
      gl.endQuery(ext.TIME_ELAPSED_EXT);
      pending.push(active);
      active = null;
    },
    get ms(): number | null {
      return ms;
    },
    dispose(): void {
      if (ext && active) gl.endQuery(ext.TIME_ELAPSED_EXT);
      for (const q of pending) gl.deleteQuery(q);
      pending.length = 0;
    },
  };
}
