import type { DetectionDebug, Line, Quad } from "../types";

/**
 * Debug visualization (spec section 8). Renders detection internals as independently-toggleable
 * layers onto a canvas overlaid on the document stage. Image layers (feature maps, accumulator)
 * are drawn as tinted heatmaps with intensity-as-alpha so they glow over the underlying frame;
 * vector layers (Hough lines, candidate quads, selected quad) are drawn on top.
 */
export type DebugLayer =
  | "colorEdge"
  | "lEdge"
  | "aEdge"
  | "bEdge"
  | "textDensity"
  | "shadow"
  | "accumulator"
  | "lines"
  | "candidates"
  | "selected";

export const DEBUG_LAYERS: { id: DebugLayer; label: string }[] = [
  { id: "colorEdge", label: "Color edge map" },
  { id: "lEdge", label: "L gradient" },
  { id: "aEdge", label: "a gradient" },
  { id: "bEdge", label: "b gradient" },
  { id: "textDensity", label: "Text density" },
  { id: "shadow", label: "Shadow edges" },
  { id: "accumulator", label: "Hough accumulator" },
  { id: "lines", label: "Detected lines" },
  { id: "candidates", label: "Candidate quads" },
  { id: "selected", label: "Selected quad" },
];

type Tint = [number, number, number];

function fieldToCanvas(field: Float32Array, w: number, h: number, tint: Tint): HTMLCanvasElement {
  let max = 0;
  for (let i = 0; i < field.length; i++) if (field[i] > max) max = field[i];
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(w, h);
  const inv = max > 0 ? 1 / max : 0;
  for (let i = 0; i < field.length; i++) {
    const v = Math.min(1, field[i] * inv);
    img.data[i * 4] = v * tint[0];
    img.data[i * 4 + 1] = v * tint[1];
    img.data[i * 4 + 2] = v * tint[2];
    img.data[i * 4 + 3] = Math.round(v * 255);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function drawField(
  ctx: CanvasRenderingContext2D,
  field: Float32Array,
  w: number,
  h: number,
  tint: Tint,
  dw: number,
  dh: number,
): void {
  const layer = fieldToCanvas(field, w, h, tint);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(layer, 0, 0, dw, dh);
}

/** Draws a Hesse-normal-form line across the whole display (feature coords × factor). */
function drawLine(ctx: CanvasRenderingContext2D, line: Line, factor: number, dw: number, dh: number): void {
  const x0 = line.rho * line.cos;
  const y0 = line.rho * line.sin;
  const span = Math.hypot(dw, dh) / factor;
  const ax = (x0 + span * -line.sin) * factor;
  const ay = (y0 + span * line.cos) * factor;
  const bx = (x0 - span * -line.sin) * factor;
  const by = (y0 - span * line.cos) * factor;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.stroke();
}

function drawQuadPath(ctx: CanvasRenderingContext2D, corners: Quad, factor: number): void {
  ctx.beginPath();
  ctx.moveTo(corners[0].x * factor, corners[0].y * factor);
  for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x * factor, corners[i].y * factor);
  ctx.closePath();
  ctx.stroke();
}

/**
 * Renders the selected debug layers. `selectedQuadSrc` is the final quad in SOURCE coordinates;
 * everything else in `debug` is in feature-map coordinates and is scaled by `displayWidth /
 * featureMaps.width`.
 */
export function renderDebugLayers(
  ctx: CanvasRenderingContext2D,
  displayWidth: number,
  displayHeight: number,
  srcWidth: number,
  debug: DetectionDebug,
  selectedQuadSrc: Quad | null,
  layers: Set<DebugLayer>,
): void {
  ctx.clearRect(0, 0, displayWidth, displayHeight);
  const maps = debug.featureMaps;
  const featureToDisplay = displayWidth / maps.width;
  const srcToDisplay = displayWidth / srcWidth;

  if (layers.has("colorEdge")) drawField(ctx, maps.magnitude, maps.width, maps.height, [255, 255, 255], displayWidth, displayHeight);
  if (layers.has("lEdge")) drawField(ctx, maps.magnitudeL, maps.width, maps.height, [120, 200, 255], displayWidth, displayHeight);
  if (layers.has("aEdge")) drawField(ctx, maps.magnitudeA, maps.width, maps.height, [255, 120, 160], displayWidth, displayHeight);
  if (layers.has("bEdge")) drawField(ctx, maps.magnitudeB, maps.width, maps.height, [255, 220, 90], displayWidth, displayHeight);
  if (layers.has("textDensity") && maps.textDensity) drawField(ctx, maps.textDensity, maps.width, maps.height, [80, 255, 120], displayWidth, displayHeight);
  if (layers.has("shadow") && maps.shadow) drawField(ctx, maps.shadow, maps.width, maps.height, [120, 160, 255], displayWidth, displayHeight);

  if (layers.has("accumulator") && debug.accumulatorHeatmap) {
    const { width, height, data } = debug.accumulatorHeatmap;
    drawField(ctx, data, width, height, [255, 140, 40], displayWidth, displayHeight);
  }

  if (layers.has("lines")) {
    ctx.strokeStyle = "rgba(80,180,255,0.5)";
    ctx.lineWidth = 1;
    for (const line of debug.lines) drawLine(ctx, line, featureToDisplay, displayWidth, displayHeight);
  }

  if (layers.has("candidates")) {
    ctx.strokeStyle = "rgba(255,200,0,0.5)";
    ctx.lineWidth = 1;
    for (const cand of debug.candidates.slice(1)) drawQuadPath(ctx, cand.corners, featureToDisplay);
  }

  if (layers.has("selected") && selectedQuadSrc) {
    ctx.strokeStyle = "#22c55e";
    ctx.lineWidth = 2.5;
    drawQuadPath(ctx, selectedQuadSrc, srcToDisplay);
  }
}
