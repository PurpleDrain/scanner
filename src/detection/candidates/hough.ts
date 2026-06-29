import type { DetectionConfig } from "../config";
import type { FeatureMaps, Line } from "../types";

/**
 * Gradient-weighted Hough transform (candidate generation, spec sections 4/Hough article).
 *
 * Each pixel votes (weighted by its gradient magnitude) for lines in Hesse normal form, but only
 * for angles near-perpendicular to its gradient — the edge normal equals the gradient direction —
 * which keeps the accumulator sharp and cheap. Local-maximum cells above a relative threshold
 * become candidate lines.
 */
export interface HoughResult {
  lines: Line[];
  stats: { peak: number; peakCount: number; thetaBins: number; rhoBins: number };
  /** Raw accumulator (thetaBins × rhoBins, row-major over theta) — only when keepAccumulator. */
  accumulator?: Float32Array;
  rhoBins?: number;
}

export function houghLines(maps: FeatureMaps, config: DetectionConfig, keepAccumulator = false): HoughResult {
  const { width, height, magnitude, direction, maxMagnitude } = maps;
  const { thetaBins, rhoBucket } = config;

  const diag = Math.hypot(width, height);
  const rhoBins = Math.ceil((2 * diag) / rhoBucket) + 1;
  const rhoOffset = diag;
  const accumulator = new Float32Array(thetaBins * rhoBins);

  const thetaStep = Math.PI / thetaBins;
  const cosTable = new Float32Array(thetaBins);
  const sinTable = new Float32Array(thetaBins);
  for (let t = 0; t < thetaBins; t++) {
    cosTable[t] = Math.cos(t * thetaStep);
    sinTable[t] = Math.sin(t * thetaStep);
  }

  const magThreshold = maxMagnitude * config.magVoteFraction;
  const halfWindowBins = Math.max(1, Math.round(config.voteAngleWindow / thetaStep));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const mag = magnitude[idx];
      if (mag < magThreshold) continue;

      let normalAngle = direction[idx];
      if (normalAngle < 0) normalAngle += Math.PI;
      if (normalAngle >= Math.PI) normalAngle -= Math.PI;
      const centerBin = Math.round(normalAngle / thetaStep);

      for (let d = -halfWindowBins; d <= halfWindowBins; d++) {
        let t = centerBin + d;
        let sign = 1;
        if (t < 0) {
          t += thetaBins;
          sign = -1;
        } else if (t >= thetaBins) {
          t -= thetaBins;
          sign = -1;
        }
        const rho = sign * (x * cosTable[t] + y * sinTable[t]);
        const rhoIdx = Math.round((rho + rhoOffset) / rhoBucket);
        if (rhoIdx < 0 || rhoIdx >= rhoBins) continue;
        accumulator[t * rhoBins + rhoIdx] += mag;
      }
    }
  }

  const { lines, peak, peakCount } = extractLines(accumulator, thetaBins, rhoBins, thetaStep, rhoOffset, config);

  return {
    lines,
    stats: { peak, peakCount, thetaBins, rhoBins },
    accumulator: keepAccumulator ? accumulator : undefined,
    rhoBins: keepAccumulator ? rhoBins : undefined,
  };
}

function extractLines(
  accumulator: Float32Array,
  thetaBins: number,
  rhoBins: number,
  thetaStep: number,
  rhoOffset: number,
  config: DetectionConfig,
): { lines: Line[]; peak: number; peakCount: number } {
  let peak = 0;
  for (let i = 0; i < accumulator.length; i++) {
    if (accumulator[i] > peak) peak = accumulator[i];
  }
  if (peak === 0) return { lines: [], peak: 0, peakCount: 0 };

  const scoreThreshold = peak * config.minLineScoreFraction;
  const candidates: Line[] = [];
  for (let t = 0; t < thetaBins; t++) {
    for (let r = 0; r < rhoBins; r++) {
      const score = accumulator[t * rhoBins + r];
      if (score < scoreThreshold) continue;
      if (!isLocalMax(accumulator, thetaBins, rhoBins, t, r, score, config)) continue;
      const theta = t * thetaStep;
      const rho = r * config.rhoBucket - rhoOffset;
      candidates.push({ theta, rho, cos: Math.cos(theta), sin: Math.sin(theta), score });
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return { lines: candidates.slice(0, config.maxCandidateLines), peak, peakCount: candidates.length };
}

function isLocalMax(
  accumulator: Float32Array,
  thetaBins: number,
  rhoBins: number,
  t: number,
  r: number,
  score: number,
  config: DetectionConfig,
): boolean {
  for (let dt = -config.nmsThetaRadius; dt <= config.nmsThetaRadius; dt++) {
    let tt = t + dt;
    let rhoFlip = false;
    if (tt < 0) {
      tt += thetaBins;
      rhoFlip = true;
    } else if (tt >= thetaBins) {
      tt -= thetaBins;
      rhoFlip = true;
    }
    for (let dr = -config.nmsRhoRadius; dr <= config.nmsRhoRadius; dr++) {
      const rr = rhoFlip ? rhoBins - 1 - (r + dr) : r + dr;
      if (rr < 0 || rr >= rhoBins) continue;
      if (accumulator[tt * rhoBins + rr] > score) return false;
    }
  }
  return true;
}
