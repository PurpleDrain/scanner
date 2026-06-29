import type { DetectionConfig } from "../config";
import { maxCornerAngleDeviation } from "../geometry";
import type { Confidence, FeatureMaps, ScoredCandidate } from "../types";

/**
 * Detection confidence (spec section 7): a 0..1 score combining how strongly we believe the
 * selected quad is really the document. Factors:
 *  - edgeStrength: gradient support along the border
 *  - quadValidity: how close the corners are to right angles (rectangularity)
 *  - scoreGap: separation from the runner-up (a clear winner is more trustworthy)
 *  - textDensity: presence of document-like interior content
 *  - geometricPlausibility: aspect-ratio plausibility
 */
const CONFIDENCE_WEIGHTS = {
  edgeStrength: 0.35,
  scoreGap: 0.2,
  quadValidity: 0.15,
  geometricPlausibility: 0.15,
  textDensity: 0.15,
};

export function computeConfidence(
  best: ScoredCandidate,
  runnerUp: ScoredCandidate | null,
  _maps: FeatureMaps,
  config: DetectionConfig,
): Confidence {
  const edgeStrength = best.components.edge;
  const textDensity = best.components.textDensity;
  const geometricPlausibility = best.components.aspectRatio;

  const deviation = maxCornerAngleDeviation(best.corners);
  const quadValidity = Math.max(0, 1 - deviation / config.maxCornerAngleDeviationDeg);

  const scoreGap = runnerUp
    ? Math.max(0, Math.min(1, (best.score - runnerUp.score) / config.confidenceScoreGapTarget))
    : 1;

  const value =
    CONFIDENCE_WEIGHTS.edgeStrength * edgeStrength +
    CONFIDENCE_WEIGHTS.scoreGap * scoreGap +
    CONFIDENCE_WEIGHTS.quadValidity * quadValidity +
    CONFIDENCE_WEIGHTS.geometricPlausibility * geometricPlausibility +
    CONFIDENCE_WEIGHTS.textDensity * textDensity;

  return {
    value: Math.max(0, Math.min(1, value)),
    edgeStrength,
    quadValidity,
    scoreGap,
    textDensity,
    geometricPlausibility,
  };
}
