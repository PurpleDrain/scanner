import type { Point, Quad } from "../documentScanner";

const HANDLE_HIT_PX = 22;
const HANDLE_RADIUS = 8;
const DEFAULT_MAX_DISPLAY_WIDTH = 720;

/** Index of the quad corner nearest `src`, within `maxDist`, else -1. */
export function nearestCornerIndex(quad: Quad, src: Point, maxDist: number): number {
  let best = -1;
  let bestDist = maxDist;
  for (let i = 0; i < 4; i++) {
    const d = Math.hypot(quad[i].x - src.x, quad[i].y - src.y);
    if (d <= bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Clamps a point to the [0,width] x [0,height] source bounds. */
export function clampPoint(p: Point, width: number, height: number): Point {
  return {
    x: Math.min(width, Math.max(0, p.x)),
    y: Math.min(height, Math.max(0, p.y)),
  };
}

export interface CornerEditorOptions {
  canvas: HTMLCanvasElement;
  source: CanvasImageSource;
  sourceWidth: number;
  sourceHeight: number;
  quad: Quad;
  maxDisplayWidth?: number;
  maxDisplayHeight?: number;
  onChange?: (quad: Quad) => void;
}

/**
 * Interactive four-corner editor over a still image. Renders the source scaled
 * to fit a display canvas, with draggable handles; reports the edited quad in
 * SOURCE coordinates. Reused for both the webcam capture still and uploads.
 */
export class CornerEditor {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly source: CanvasImageSource;
  private readonly sourceWidth: number;
  private readonly sourceHeight: number;
  private readonly onChange?: (quad: Quad) => void;
  private readonly displayScale: number;
  private quad: Quad;
  private dragIndex = -1;

  private readonly onPointerDown = (e: PointerEvent) => this.handleDown(e);
  private readonly onPointerMove = (e: PointerEvent) => this.handleMove(e);
  private readonly onPointerUp = (e: PointerEvent) => this.handleUp(e);

  constructor(opts: CornerEditorOptions) {
    this.canvas = opts.canvas;
    this.ctx = this.canvas.getContext("2d")!;
    this.source = opts.source;
    this.sourceWidth = opts.sourceWidth;
    this.sourceHeight = opts.sourceHeight;
    this.onChange = opts.onChange;
    this.quad = cloneQuad(opts.quad);

    const maxWidth = opts.maxDisplayWidth ?? DEFAULT_MAX_DISPLAY_WIDTH;
    const maxHeight = opts.maxDisplayHeight ?? Number.POSITIVE_INFINITY;
    const scaleW = maxWidth / this.sourceWidth;
    const scaleH = maxHeight / this.sourceHeight;
    this.displayScale = Math.min(1, scaleW, scaleH);
    this.canvas.width = Math.max(1, Math.round(this.sourceWidth * this.displayScale));
    this.canvas.height = Math.max(1, Math.round(this.sourceHeight * this.displayScale));

    this.canvas.addEventListener("pointerdown", this.onPointerDown);
    this.canvas.addEventListener("pointermove", this.onPointerMove);
    this.canvas.addEventListener("pointerup", this.onPointerUp);
    this.canvas.addEventListener("pointercancel", this.onPointerUp);

    this.render();
  }

  getQuad(): Quad {
    return cloneQuad(this.quad);
  }

  destroy(): void {
    this.canvas.removeEventListener("pointerdown", this.onPointerDown);
    this.canvas.removeEventListener("pointermove", this.onPointerMove);
    this.canvas.removeEventListener("pointerup", this.onPointerUp);
    this.canvas.removeEventListener("pointercancel", this.onPointerUp);
  }

  private pointerToSource(e: PointerEvent): Point {
    const rect = this.canvas.getBoundingClientRect();
    const cx = ((e.clientX - rect.left) / rect.width) * this.canvas.width;
    const cy = ((e.clientY - rect.top) / rect.height) * this.canvas.height;
    return { x: cx / this.displayScale, y: cy / this.displayScale };
  }

  private handleDown(e: PointerEvent): void {
    const src = this.pointerToSource(e);
    const hitRadius = HANDLE_HIT_PX / this.displayScale;
    const idx = nearestCornerIndex(this.quad, src, hitRadius);
    if (idx >= 0) {
      this.dragIndex = idx;
      this.canvas.setPointerCapture(e.pointerId);
      e.preventDefault();
    }
  }

  private handleMove(e: PointerEvent): void {
    if (this.dragIndex < 0) return;
    this.quad[this.dragIndex] = clampPoint(this.pointerToSource(e), this.sourceWidth, this.sourceHeight);
    this.render();
    this.onChange?.(cloneQuad(this.quad));
    e.preventDefault();
  }

  private handleUp(e: PointerEvent): void {
    if (this.dragIndex < 0) return;
    this.dragIndex = -1;
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {
      // pointer may already be released
    }
  }

  private render(): void {
    const s = this.displayScale;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.drawImage(this.source, 0, 0, this.canvas.width, this.canvas.height);

    const pts = this.quad.map((p) => ({ x: p.x * s, y: p.y * s }));

    this.ctx.save();
    this.ctx.strokeStyle = "#22c55e";
    this.ctx.lineWidth = 2;
    this.ctx.lineJoin = "round";
    this.ctx.beginPath();
    this.ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) this.ctx.lineTo(pts[i].x, pts[i].y);
    this.ctx.closePath();
    this.ctx.stroke();

    this.ctx.fillStyle = "rgba(34,197,94,0.9)";
    this.ctx.strokeStyle = "#0b0d10";
    this.ctx.lineWidth = 2;
    for (const p of pts) {
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, HANDLE_RADIUS, 0, Math.PI * 2);
      this.ctx.fill();
      this.ctx.stroke();
    }
    this.ctx.restore();
  }
}

function cloneQuad(quad: Quad): Quad {
  return [
    { x: quad[0].x, y: quad[0].y },
    { x: quad[1].x, y: quad[1].y },
    { x: quad[2].x, y: quad[2].y },
    { x: quad[3].x, y: quad[3].y },
  ];
}
