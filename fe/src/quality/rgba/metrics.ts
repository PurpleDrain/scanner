import type { Quad } from "../../documentScanner";
import type { GlareThresholds } from "../config";
import type { BlurMetric, BrightnessMetric, GlareMetric } from "../types";

/**
 * Reference document width for resolution-normalized blur scoring — matches
 * `resolution.excellentWidthPx` so thresholds stay comparable across warp sizes.
 */
export const BLUR_REFERENCE_WIDTH = 2400;

/**
 * Pure-JS reimplementations of the OpenCV quality metrics, operating directly
 * on an RGBA pixel buffer (e.g. the WebGL-warped document crop). These let the
 * quality pipeline run on the main thread without loading OpenCV.
 *
 * The grayscale conversion matches OpenCV's `COLOR_RGBA2GRAY` (Rec.601 luma),
 * so the metrics line up with the existing thresholds in `config.ts`.
 */

const UNDEREXPOSED_PIXEL_VALUE = 10;
const OVEREXPOSED_PIXEL_VALUE = 245;

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Scale Laplacian variance as if the image were `BLUR_REFERENCE_WIDTH` wide. */
export function normalizeBlurVariance(variance: number, width: number): number {
  const w = Math.max(1, width);
  const scale = BLUR_REFERENCE_WIDTH / w;
  return variance * scale * scale;
}

function cropRgba(
  data: Uint8ClampedArray,
  imageWidth: number,
  x0: number,
  y0: number,
  cropWidth: number,
  cropHeight: number,
): Uint8ClampedArray {
  const crop = new Uint8ClampedArray(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y++) {
    const srcStart = ((y0 + y) * imageWidth + x0) * 4;
    crop.set(data.subarray(srcStart, srcStart + cropWidth * 4), y * cropWidth * 4);
  }
  return crop;
}

/**
 * Laplacian variance on the axis-aligned document region in the original photo.
 * Avoids penalizing sharp captures for softness introduced by perspective warp
 * interpolation and normalizes for how large the document is in the frame.
 */
export function computeBlurMetricRgbaSourceRegion(
  data: Uint8ClampedArray,
  imageWidth: number,
  imageHeight: number,
  quad: Quad,
): BlurMetric {
  const xs = quad.map((p) => p.x);
  const ys = quad.map((p) => p.y);
  const x0 = Math.max(0, Math.floor(Math.min(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const x1 = Math.min(imageWidth, Math.ceil(Math.max(...xs)));
  const y1 = Math.min(imageHeight, Math.ceil(Math.max(...ys)));
  const cropWidth = x1 - x0;
  const cropHeight = y1 - y0;
  if (cropWidth < 3 || cropHeight < 3) return { blurVariance: 0 };

  const crop = cropRgba(data, imageWidth, x0, y0, cropWidth, cropHeight);
  return computeBlurMetricRgba(crop, cropWidth, cropHeight);
}

/** Variance of a 3x3 Laplacian over the luma plane (interior pixels). Higher = sharper. */
export function computeBlurMetricRgba(data: Uint8ClampedArray, width: number, height: number): BlurMetric {
  if (width < 3 || height < 3) return { blurVariance: 0 };

  const plane = new Float32Array(width * height);
  for (let i = 0; i < plane.length; i++) {
    const o = i * 4;
    plane[i] = luma(data[o]!, data[o + 1]!, data[o + 2]!);
  }

  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      const lap = plane[idx - 1]! + plane[idx + 1]! + plane[idx - width]! + plane[idx + width]! - 4 * plane[idx]!;
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  return { blurVariance: normalizeBlurVariance(Math.max(0, variance), width) };
}

/** Mean luma plus the fraction of pixels clipped near black/white. */
export function computeBrightnessMetricRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): BrightnessMetric {
  const total = width * height;
  let sum = 0;
  let under = 0;
  let over = 0;

  for (let i = 0; i < total; i++) {
    const o = i * 4;
    const y = luma(data[o]!, data[o + 1]!, data[o + 2]!);
    sum += y;
    if (y <= UNDEREXPOSED_PIXEL_VALUE) under++;
    else if (y > OVEREXPOSED_PIXEL_VALUE) over++;
  }

  return {
    meanBrightness: sum / total,
    underexposedFraction: under / total,
    overexposedFraction: over / total,
  };
}

/**
 * Percentage of pixels that are both very bright (high HSV value) and
 * desaturated (low HSV saturation) — the signature of specular glare.
 * Mirrors the OpenCV HSV thresholding in `metrics/glare.ts`.
 */
export function computeGlareMetricRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  thresholds: GlareThresholds,
): GlareMetric {
  const total = width * height;
  let glare = 0;

  for (let i = 0; i < total; i++) {
    const o = i * 4;
    const r = data[o]!;
    const g = data[o + 1]!;
    const b = data[o + 2]!;
    const value = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = value === 0 ? 0 : ((value - min) / value) * 255;
    if (value > thresholds.brightnessThreshold && saturation <= thresholds.saturationThreshold) {
      glare++;
    }
  }

  return { glareCoveragePercent: (glare / total) * 100 };
}
