import type { Point } from "../types";

/** Bilinear upscale of a single-channel float map. */
export function resizeFloatBilinear(
  src: Float32Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Float32Array {
  const dst = new Float32Array(dstW * dstH);
  const xScale = srcW / dstW;
  const yScale = srcH / dstH;

  for (let y = 0; y < dstH; y++) {
    const srcY = (y + 0.5) * yScale - 0.5;
    const y0 = Math.max(0, Math.floor(srcY));
    const y1 = Math.min(srcH - 1, y0 + 1);
    const fy = srcY - y0;

    for (let x = 0; x < dstW; x++) {
      const srcX = (x + 0.5) * xScale - 0.5;
      const x0 = Math.max(0, Math.floor(srcX));
      const x1 = Math.min(srcW - 1, x0 + 1);
      const fx = srcX - x0;

      const v00 = src[y0 * srcW + x0];
      const v10 = src[y0 * srcW + x1];
      const v01 = src[y1 * srcW + x0];
      const v11 = src[y1 * srcW + x1];
      const top = v00 + (v10 - v00) * fx;
      const bottom = v01 + (v11 - v01) * fx;
      dst[y * dstW + x] = top + (bottom - top) * fy;
    }
  }

  return dst;
}

/** Weighted centroid of pixels above `threshold` (DocAligner-style soft localization). */
export function centroidAboveThreshold(
  heatmap: Float32Array,
  width: number,
  height: number,
  threshold: number,
): Point | null {
  let sumX = 0;
  let sumY = 0;
  let sumW = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = heatmap[y * width + x];
      if (v < threshold) continue;
      sumX += x * v;
      sumY += y * v;
      sumW += v;
    }
  }

  if (sumW < 1e-6) return null;
  return { x: sumX / sumW, y: sumY / sumW };
}

/** Centroid on a low-res heatmap, mapped to original image coordinates. */
export function centroidOnHeatmap(
  channel: Float32Array,
  heatW: number,
  heatH: number,
  origW: number,
  origH: number,
  threshold: number,
): Point | null {
  const pt = centroidAboveThreshold(channel, heatW, heatH, threshold);
  if (!pt) return null;
  return {
    x: ((pt.x + 0.5) / heatW) * origW,
    y: ((pt.y + 0.5) / heatH) * origH,
  };
}

export function maxHeatmapValue(heatmap: Float32Array): number {
  let peak = 0;
  for (let i = 0; i < heatmap.length; i++) {
    if (heatmap[i] > peak) peak = heatmap[i];
  }
  return peak;
}
