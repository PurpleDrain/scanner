import type { BrightnessThresholds } from "../config";
import type { BrightnessMetric, BrightnessResult, BrightnessStatus } from "../types";
import { piecewiseLinearScore } from "./utils";

export function scoreBrightness(metric: BrightnessMetric, thresholds: BrightnessThresholds): BrightnessResult {
  const { meanBrightness } = metric;

  // Triangular scoring centered on `idealMean`: score falls off toward 50 at
  // the under/over-exposure boundary, and toward 0 at the extremes (pure
  // black or pure white).
  const brightnessScore = piecewiseLinearScore(meanBrightness, [
    { value: 0, score: 0 },
    { value: thresholds.underexposedMean, score: 50 },
    { value: thresholds.idealMean, score: 100 },
    { value: thresholds.overexposedMean, score: 50 },
    { value: 255, score: 0 },
  ]);

  let brightnessStatus: BrightnessStatus;
  if (meanBrightness < thresholds.underexposedMean) brightnessStatus = "too_dark";
  else if (meanBrightness > thresholds.overexposedMean) brightnessStatus = "too_bright";
  else brightnessStatus = "good";

  return { ...metric, brightnessScore: Math.round(brightnessScore), brightnessStatus };
}
