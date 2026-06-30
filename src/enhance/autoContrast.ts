/**
 * Auto-contrast / white normalization for a flattened document crop.
 *
 * Builds a luma histogram, finds the low/high percentile luma values, and
 * linearly stretches every channel so that near-black shadow maps to 0 and the
 * page white maps to 255. This lifts faded scans and neutralizes uneven
 * lighting without any dependency. Returns a new RGBA buffer; alpha is
 * preserved.
 */
export function enhanceAutoContrast(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  lowPercentile = 0.01,
  highPercentile = 0.99,
): Uint8ClampedArray {
  const total = width * height;
  const out = new Uint8ClampedArray(data.length);
  if (total === 0) {
    out.set(data);
    return out;
  }

  const histogram = new Int32Array(256);
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    const y = Math.round(0.299 * data[o]! + 0.587 * data[o + 1]! + 0.114 * data[o + 2]!);
    histogram[y]!++;
  }

  const low = percentileValue(histogram, total * lowPercentile);
  const high = percentileValue(histogram, total * highPercentile);

  if (high <= low) {
    out.set(data);
    return out;
  }

  const scale = 255 / (high - low);
  for (let i = 0; i < total; i++) {
    const o = i * 4;
    out[o] = (data[o]! - low) * scale;
    out[o + 1] = (data[o + 1]! - low) * scale;
    out[o + 2] = (data[o + 2]! - low) * scale;
    out[o + 3] = data[o + 3]!;
  }
  return out;
}

/** Smallest luma value at which the cumulative pixel count reaches `target`. */
function percentileValue(histogram: Int32Array, target: number): number {
  let cumulative = 0;
  for (let v = 0; v < 256; v++) {
    cumulative += histogram[v]!;
    if (cumulative >= target) return v;
  }
  return 255;
}
