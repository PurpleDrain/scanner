import type { PerspectiveThresholds } from "../config";
import type { EdgeMetrics, PerspectiveResult } from "../types";
import { clamp, piecewiseLinearScore } from "./utils";

export function scorePerspective(metric: EdgeMetrics, thresholds: PerspectiveThresholds): PerspectiveResult {
  const deviationScore = piecewiseLinearScore(metric.cornerDeviation, [
    { value: thresholds.excellentDeviationDegrees, score: 100 },
    { value: thresholds.poorDeviationDegrees, score: 0 },
  ]);
  const symmetryScore = clamp(metric.edgeSymmetry * 100, 0, 100);

  const perspectiveScore =
    thresholds.deviationWeight * deviationScore + (1 - thresholds.deviationWeight) * symmetryScore;

  return { ...metric, perspectiveScore: Math.round(perspectiveScore) };
}
