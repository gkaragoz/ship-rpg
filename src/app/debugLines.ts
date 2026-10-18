import type { GameView } from '../core';
import type { RenderStats } from '../render';
import type { GraphicsSettings } from '../settings';

/** The overlay lines both screens share: draw cost, memory, resolution and the quality in force. */
export function renderLines(s: RenderStats, g: GraphicsSettings): string[] {
  const lines = [`Çizim      ${s.calls} çağrı  ${(s.triangles / 1000).toFixed(0)}k üçgen`];
  if (s.gpuMs !== null) lines.push(`GPU        ${s.gpuMs.toFixed(2)} ms`);
  lines.push(
    `Bellek     ${s.geometries} geometri  ${s.textures} doku`,
    `Çözünürlük ${s.width}×${s.height} (%${Math.round(s.scale * 100)})  ${s.samples ? `MSAA ${s.samples}x` : 'MSAA yok'}${s.hdr ? '  HDR' : ''}${s.composer ? '' : '  (doğrudan)'}`,
    `Kalite     ${g.preset}  su ${g.water}  gölge ${g.shadows}`,
    `Işık       AO ${g.ambientOcclusion}  GI ${g.globalIllumination}`,
  );
  return lines;
}

/** What is going on in the game: counters, the sea and the wind. */
export function gameLines(v: GameView): string[] {
  return [
    `Oyun       ${v.enemies.length} düşman  ${v.others.length} gemi  ${v.balls.length} gülle  ${v.crew.length} tayfa`,
    `Deniz      ${v.seaState.toFixed(2)}  rüzgâr ${v.wind.speed.toFixed(1)} m/s`,
  ];
}
