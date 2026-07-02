import type { GradeThresholds, QualityWeights } from "../config";
import type { QualityLevel } from "../types";

export interface WeightedScores {
  blurScore: number;
  glareScore: number;
  perspectiveScore: number;
  resolutionScore: number;
}

/**
 * Brightness is intentionally excluded from the weighted overall score: it is
 * surfaced as its own diagnostic and feeds recommendations, but the explicit
 * weighting spec for this module covers blur/glare/perspective/resolution
 * only (summing to 100%). Revisit if brightness should carry its own weight.
 */
export function computeOverallScore(
  scores: WeightedScores,
  weights: QualityWeights,
  gradeThresholds: GradeThresholds,
): { overallScore: number; qualityGrade: QualityLevel } {
  const overallScore = Math.round(
    scores.blurScore * weights.blur +
      scores.glareScore * weights.glare +
      scores.perspectiveScore * weights.perspective +
      scores.resolutionScore * weights.resolution,
  );

  let qualityGrade: QualityLevel;
  if (overallScore >= gradeThresholds.excellent) qualityGrade = "excellent";
  else if (overallScore >= gradeThresholds.good) qualityGrade = "good";
  else if (overallScore >= gradeThresholds.acceptable) qualityGrade = "acceptable";
  else if (overallScore >= gradeThresholds.poor) qualityGrade = "poor";
  else qualityGrade = "unusable";

  return { overallScore, qualityGrade };
}
