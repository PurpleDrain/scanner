import type { ResolutionThresholds } from "../config";
import type { ResolutionMetric, ResolutionResult } from "../types";
import { piecewiseLinearScore } from "./utils";

/**
 * Scores on document *width* only: our quad ordering always treats the
 * longer dimension consistently relative to the page, and width is the
 * dimension most often constrained by how close the camera was held —
 * the single biggest lever a user can act on (see recommendations.ts).
 */
export function scoreResolution(metric: ResolutionMetric, thresholds: ResolutionThresholds): ResolutionResult {
  const resolutionScore = piecewiseLinearScore(metric.width, [
    { value: 0, score: 0 },
    { value: thresholds.poorWidthPx, score: 25 },
    { value: thresholds.acceptableWidthPx, score: 50 },
    { value: thresholds.goodWidthPx, score: 75 },
    { value: thresholds.excellentWidthPx, score: 100 },
  ]);

  return { ...metric, resolutionScore: Math.round(resolutionScore) };
}
