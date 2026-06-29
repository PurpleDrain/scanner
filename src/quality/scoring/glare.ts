import type { GlareThresholds } from "../config";
import type { GlareMetric, GlareResult, GlareSeverity } from "../types";
import { piecewiseLinearScore } from "./utils";

export function scoreGlare(metric: GlareMetric, thresholds: GlareThresholds): GlareResult {
  const { glareCoveragePercent } = metric;

  const severeCoveragePercent = thresholds.moderateCoveragePercent * 2;
  const glareScore = piecewiseLinearScore(glareCoveragePercent, [
    { value: 0, score: 100 },
    { value: thresholds.noneCoveragePercent, score: 90 },
    { value: thresholds.minorCoveragePercent, score: 70 },
    { value: thresholds.moderateCoveragePercent, score: 40 },
    { value: severeCoveragePercent, score: 0 },
  ]);

  let glareSeverity: GlareSeverity;
  if (glareCoveragePercent <= thresholds.noneCoveragePercent) glareSeverity = "none";
  else if (glareCoveragePercent <= thresholds.minorCoveragePercent) glareSeverity = "minor";
  else if (glareCoveragePercent <= thresholds.moderateCoveragePercent) glareSeverity = "moderate";
  else glareSeverity = "severe";

  return { glareCoveragePercent, glareScore: Math.round(glareScore), glareSeverity };
}
