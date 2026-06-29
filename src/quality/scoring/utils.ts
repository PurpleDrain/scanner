export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export interface ScoreAnchor {
  value: number;
  score: number;
}

/**
 * Piecewise-linear interpolation through a set of (value, score) anchors.
 * Anchors do not need to be sorted or monotonic in `value`; they are sorted
 * by `value` internally. Values outside the anchor range clamp to the
 * nearest endpoint's score.
 */
export function piecewiseLinearScore(value: number, anchors: ScoreAnchor[]): number {
  const sorted = [...anchors].sort((a, b) => a.value - b.value);
  if (sorted.length === 0) {
    throw new Error("piecewiseLinearScore requires at least one anchor");
  }
  if (value <= sorted[0].value) return clamp(sorted[0].score, 0, 100);
  if (value >= sorted[sorted.length - 1].value) return clamp(sorted[sorted.length - 1].score, 0, 100);

  for (let i = 0; i < sorted.length - 1; i++) {
    const lo = sorted[i];
    const hi = sorted[i + 1];
    if (value >= lo.value && value <= hi.value) {
      const t = hi.value === lo.value ? 0 : (value - lo.value) / (hi.value - lo.value);
      return clamp(lo.score + t * (hi.score - lo.score), 0, 100);
    }
  }
  // Unreachable given the bounds checks above.
  return clamp(sorted[sorted.length - 1].score, 0, 100);
}
