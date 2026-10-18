/** Draw an anchor (ring, shank, stock, flukes) centred on `(x, y)`, `size` px tall; used for ports on the minimap and the chart. */
export function drawAnchor(ctx: CanvasRenderingContext2D, x: number, y: number, size: number, color: string, outline = 'rgba(20, 14, 6, 0.85)'): void {
  const r = size / 2;
  const trace = (): void => {
    ctx.beginPath();
    ctx.arc(x, y - r * 0.72, r * 0.2, 0, Math.PI * 2); // ring
    ctx.moveTo(x, y - r * 0.52);
    ctx.lineTo(x, y + r * 0.8); // shank
    ctx.moveTo(x - r * 0.42, y - r * 0.28);
    ctx.lineTo(x + r * 0.42, y - r * 0.28); // stock
    ctx.moveTo(x - r * 0.8, y + r * 0.22); // flukes
    ctx.quadraticCurveTo(x - r * 0.7, y + r * 0.95, x, y + r * 0.8);
    ctx.quadraticCurveTo(x + r * 0.7, y + r * 0.95, x + r * 0.8, y + r * 0.22);
  };
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = outline;
  ctx.lineWidth = Math.max(2, size * 0.26);
  trace();
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(1, size * 0.13);
  trace();
  ctx.stroke();
  ctx.restore();
}
