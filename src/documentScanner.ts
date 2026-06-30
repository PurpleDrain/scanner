import type { Quad } from "./detection/types";

export type { Point, Quad } from "./detection/types";
export { orderCorners } from "./detection/geometry";

/** Draws the quad outline and corner markers onto a 2D canvas context. */
export function drawQuadOutline(
  ctx: CanvasRenderingContext2D,
  quad: Quad,
  options: { stroke?: string; lineWidth?: number; cornerRadius?: number } = {},
): void {
  const { stroke = "#22c55e", lineWidth = 3, cornerRadius = 6 } = options;

  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(quad[0].x, quad[0].y);
  for (let i = 1; i < quad.length; i++) {
    ctx.lineTo(quad[i].x, quad[i].y);
  }
  ctx.closePath();
  ctx.stroke();

  for (const point of quad) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, cornerRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
