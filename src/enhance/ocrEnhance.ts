/**
 * OCR / VLM-optimized enhancement for a flattened document crop.
 *
 * Unlike a global contrast stretch, this flattens uneven illumination so
 * shadows and lighting gradients are removed while faint strokes survive:
 *
 *   1. Estimate the background ("paper" brightness) per channel on a small grid,
 *      using a high percentile per cell so dark text does not drag it down.
 *   2. Divide each channel by its background (flat-field / division
 *      normalization). This removes shadows AND white-balances the page, since
 *      each channel's paper level maps to white.
 *   3. Gently normalize contrast with a soft percentile white/black point,
 *      applied uniformly across channels to keep colour and faint strokes.
 *   4. Apply a mild unsharp mask to crisp edges for text recognition.
 *
 * Output stays in colour and preserves alpha. Assumes dark text on lighter
 * paper (the document case); extreme inverse-contrast images are out of scope.
 */

export interface OcrEnhanceOptions {
  /** Longest-side size of the downsampled background grid (px). */
  backgroundGridSize?: number;
  /** Percentile (0..1) per grid cell used to estimate paper brightness. */
  backgroundPercentile?: number;
  /** Box-blur passes applied to the background grid for smoothness. */
  backgroundSmoothPasses?: number;
  /** Target value (0..255) that the estimated background maps to. */
  targetWhite?: number;
  /** Floor applied to the background to avoid amplifying noise in dark areas. */
  backgroundFloor?: number;
  /** Maximum per-pixel gain from the division step. */
  maxGain?: number;
  /** Low luma percentile (0..1) for the final normalization. */
  lowPercentile?: number;
  /** High luma percentile (0..1) for the final normalization. */
  highPercentile?: number;
  /** Luma value the low percentile maps to (lifted, not crushed to 0). */
  blackPoint?: number;
  /** Luma value the high percentile maps to (kept below 255 to spare strokes). */
  whitePoint?: number;
  /** Cap on the contrast multiplier so near-uniform pages aren't blown up. */
  maxContrastScale?: number;
  /** Unsharp mask strength (0 disables). */
  sharpenAmount?: number;
}

const DEFAULTS: Required<OcrEnhanceOptions> = {
  backgroundGridSize: 96,
  backgroundPercentile: 0.75,
  backgroundSmoothPasses: 2,
  targetWhite: 245,
  backgroundFloor: 12,
  maxGain: 3.5,
  lowPercentile: 0.02,
  highPercentile: 0.98,
  blackPoint: 8,
  whitePoint: 248,
  maxContrastScale: 2.5,
  sharpenAmount: 0.6,
};

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Per-channel background grid (RGB). Each cell is the `percentile` brightness of
 * the source pixels that fall in it, so dark text is ignored and the grid
 * tracks paper / illumination.
 */
export function estimateBackgroundGrid(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  gridSize: number,
  percentile: number,
): { grid: Float32Array; gridW: number; gridH: number } {
  const longSide = Math.max(width, height);
  const cells = Math.max(1, Math.min(gridSize, longSide));
  const scale = cells / longSide;
  const gridW = Math.max(1, Math.round(width * scale));
  const gridH = Math.max(1, Math.round(height * scale));

  const grid = new Float32Array(gridW * gridH * 3);

  const cellW = width / gridW;
  const cellH = height / gridH;

  // Reusable per-channel sample buffers sized for the largest possible cell.
  const maxSamples = Math.max(1, Math.ceil(cellW) + 1) * Math.max(1, Math.ceil(cellH) + 1);
  const samplesR = new Float32Array(maxSamples);
  const samplesG = new Float32Array(maxSamples);
  const samplesB = new Float32Array(maxSamples);

  for (let gy = 0; gy < gridH; gy++) {
    const y0 = Math.floor(gy * cellH);
    const y1 = Math.min(height, Math.floor((gy + 1) * cellH) || y0 + 1);
    for (let gx = 0; gx < gridW; gx++) {
      const x0 = Math.floor(gx * cellW);
      const x1 = Math.min(width, Math.floor((gx + 1) * cellW) || x0 + 1);

      let n = 0;
      for (let y = y0; y < Math.max(y1, y0 + 1); y++) {
        if (y >= height) break;
        const row = y * width;
        for (let x = x0; x < Math.max(x1, x0 + 1); x++) {
          if (x >= width) break;
          const o = (row + x) * 4;
          if (n < maxSamples) {
            samplesR[n] = data[o]!;
            samplesG[n] = data[o + 1]!;
            samplesB[n] = data[o + 2]!;
            n++;
          }
        }
      }

      const gi = (gy * gridW + gx) * 3;
      grid[gi] = percentileOf(samplesR, n, percentile);
      grid[gi + 1] = percentileOf(samplesG, n, percentile);
      grid[gi + 2] = percentileOf(samplesB, n, percentile);
    }
  }

  return { grid, gridW, gridH };
}

/** In-place selection of the `p` percentile of the first `n` samples. */
function percentileOf(samples: Float32Array, n: number, p: number): number {
  if (n <= 0) return 255;
  const view = samples.subarray(0, n);
  const sorted = Array.prototype.slice.call(view) as number[];
  sorted.sort((a, b) => a - b);
  const idx = Math.min(n - 1, Math.max(0, Math.round(p * (n - 1))));
  return sorted[idx]!;
}

/** Separable 3x box blur over an RGB grid (in place across passes). */
function boxBlurGrid(grid: Float32Array, gridW: number, gridH: number, passes: number): Float32Array {
  let src = grid;
  for (let pass = 0; pass < passes; pass++) {
    const tmp = new Float32Array(src.length);
    // Horizontal
    for (let y = 0; y < gridH; y++) {
      for (let x = 0; x < gridW; x++) {
        const xm = Math.max(0, x - 1);
        const xp = Math.min(gridW - 1, x + 1);
        for (let c = 0; c < 3; c++) {
          const a = src[(y * gridW + xm) * 3 + c]!;
          const b = src[(y * gridW + x) * 3 + c]!;
          const d = src[(y * gridW + xp) * 3 + c]!;
          tmp[(y * gridW + x) * 3 + c] = (a + b + d) / 3;
        }
      }
    }
    const out = new Float32Array(src.length);
    // Vertical
    for (let y = 0; y < gridH; y++) {
      const ym = Math.max(0, y - 1);
      const yp = Math.min(gridH - 1, y + 1);
      for (let x = 0; x < gridW; x++) {
        for (let c = 0; c < 3; c++) {
          const a = tmp[(ym * gridW + x) * 3 + c]!;
          const b = tmp[(y * gridW + x) * 3 + c]!;
          const d = tmp[(yp * gridW + x) * 3 + c]!;
          out[(y * gridW + x) * 3 + c] = (a + b + d) / 3;
        }
      }
    }
    src = out;
  }
  return src;
}

/** Bilinearly sample one channel of the RGB grid at fractional grid coords. */
function sampleGrid(
  grid: Float32Array,
  gridW: number,
  gridH: number,
  gx: number,
  gy: number,
  channel: number,
): number {
  const x = Math.min(gridW - 1, Math.max(0, gx));
  const y = Math.min(gridH - 1, Math.max(0, gy));
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(gridW - 1, x0 + 1);
  const y1 = Math.min(gridH - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;

  const v00 = grid[(y0 * gridW + x0) * 3 + channel]!;
  const v10 = grid[(y0 * gridW + x1) * 3 + channel]!;
  const v01 = grid[(y1 * gridW + x0) * 3 + channel]!;
  const v11 = grid[(y1 * gridW + x1) * 3 + channel]!;
  const top = v00 + (v10 - v00) * fx;
  const bottom = v01 + (v11 - v01) * fx;
  return top + (bottom - top) * fy;
}

/** Smallest luma value at which the cumulative count reaches `target`. */
function percentileValue(histogram: Int32Array, target: number): number {
  let cumulative = 0;
  for (let v = 0; v < 256; v++) {
    cumulative += histogram[v]!;
    if (cumulative >= target) return v;
  }
  return 255;
}

export function enhanceForOcr(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  options: OcrEnhanceOptions = {},
): Uint8ClampedArray {
  const opts = { ...DEFAULTS, ...options };
  const total = width * height;
  const out = new Uint8ClampedArray(data.length);
  if (total === 0) {
    out.set(data);
    return out;
  }

  // 1. Background estimation + smoothing.
  const { grid, gridW, gridH } = estimateBackgroundGrid(
    data,
    width,
    height,
    opts.backgroundGridSize,
    opts.backgroundPercentile,
  );
  const bg = boxBlurGrid(grid, gridW, gridH, opts.backgroundSmoothPasses);

  // 2. Division normalization (per channel) -> flat, white-balanced page.
  const gridScaleX = gridW / width;
  const gridScaleY = gridH / height;
  for (let y = 0; y < height; y++) {
    const gy = (y + 0.5) * gridScaleY - 0.5;
    for (let x = 0; x < width; x++) {
      const gx = (x + 0.5) * gridScaleX - 0.5;
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const background = Math.max(opts.backgroundFloor, sampleGrid(bg, gridW, gridH, gx, gy, c));
        const gain = Math.min(opts.maxGain, opts.targetWhite / background);
        out[o + c] = data[o + c]! * gain;
      }
      out[o + 3] = data[o + 3]!;
    }
  }

  // 3. Gentle global normalization on luma, applied uniformly across channels.
  const histogram = new Int32Array(256);
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    histogram[Math.round(luma(out[o]!, out[o + 1]!, out[o + 2]!))]!++;
  }
  const low = percentileValue(histogram, total * opts.lowPercentile);
  const high = percentileValue(histogram, total * opts.highPercentile);
  if (high > low) {
    // Anchor the stretch at the paper (high) point and cap the gain. Anchoring
    // at white keeps paper near `whitePoint` even when the document is mostly
    // background (sparse text), instead of dragging it dark; the cap keeps the
    // adjustment gentle and avoids amplifying noise on near-uniform pages.
    const scale = Math.min(opts.maxContrastScale, (opts.whitePoint - opts.blackPoint) / (high - low));
    for (let i = 0; i < total; i++) {
      const o = i * 4;
      out[o] = (out[o]! - high) * scale + opts.whitePoint;
      out[o + 1] = (out[o + 1]! - high) * scale + opts.whitePoint;
      out[o + 2] = (out[o + 2]! - high) * scale + opts.whitePoint;
    }
  }

  // 4. Mild unsharp mask for crisper strokes.
  if (opts.sharpenAmount > 0) {
    return unsharpMask(out, width, height, opts.sharpenAmount);
  }
  return out;
}

/** 3x3 box-blur unsharp mask: out = src + amount * (src - blur). Preserves alpha. */
export function unsharpMask(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    const ym = Math.max(0, y - 1);
    const yp = Math.min(height - 1, y + 1);
    for (let x = 0; x < width; x++) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(width - 1, x + 1);
      const o = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const blur =
          (data[(ym * width + xm) * 4 + c]! +
            data[(ym * width + x) * 4 + c]! +
            data[(ym * width + xp) * 4 + c]! +
            data[(y * width + xm) * 4 + c]! +
            data[(y * width + x) * 4 + c]! +
            data[(y * width + xp) * 4 + c]! +
            data[(yp * width + xm) * 4 + c]! +
            data[(yp * width + x) * 4 + c]! +
            data[(yp * width + xp) * 4 + c]!) /
          9;
        out[o + c] = data[o + c]! + amount * (data[o + c]! - blur);
      }
      out[o + 3] = data[o + 3]!;
    }
  }
  return out;
}
