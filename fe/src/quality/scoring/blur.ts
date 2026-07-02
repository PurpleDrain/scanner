import type { BlurThresholds } from "../config";
import type { BlurMetric, BlurResult, QualityLevel } from "../types";
import { piecewiseLinearScore } from "./utils";

export function scoreBlur(metric: BlurMetric, thresholds: BlurThresholds): BlurResult {
  const { blurVariance } = metric;

  const blurScore = piecewiseLinearScore(blurVariance, [
    { value: 0, score: 0 },
    { value: thresholds.poorVariance, score: 25 },
    { value: thresholds.acceptableVariance, score: 50 },
    { value: thresholds.goodVariance, score: 75 },
    { value: thresholds.excellentVariance, score: 100 },
  ]);

  let blurSeverity: QualityLevel;
  if (blurVariance >= thresholds.excellentVariance) blurSeverity = "excellent";
  else if (blurVariance >= thresholds.goodVariance) blurSeverity = "good";
  else if (blurVariance >= thresholds.acceptableVariance) blurSeverity = "acceptable";
  else if (blurVariance >= thresholds.poorVariance) blurSeverity = "poor";
  else blurSeverity = "unusable";

  return { blurVariance, blurScore: Math.round(blurScore), blurSeverity };
}
