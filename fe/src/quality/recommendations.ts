import type { GuidanceConfig } from "./config";
import type { BlurResult, BrightnessResult, GlareResult, PerspectiveResult, ResolutionResult } from "./types";

export interface QualityMetricResults {
  blur: BlurResult;
  brightness: BrightnessResult;
  glare: GlareResult;
  perspective: PerspectiveResult;
  resolution: ResolutionResult;
}

/**
 * Generates user-facing guidance, limited to metrics that are actually weak
 * (score below `guidance.weakScoreThreshold`, or for brightness/glare, whose
 * scoring is two-sided/bucketed, the relevant non-"good"/"none" status).
 * Returns an empty array when the capture is already solid.
 */
export function generateRecommendations(metrics: QualityMetricResults, guidance: GuidanceConfig): string[] {
  const recommendations: string[] = [];
  const { weakScoreThreshold } = guidance;

  if (metrics.blur.blurScore < weakScoreThreshold) {
    recommendations.push("Image is blurry. Hold the phone steady.");
  }

  if (metrics.brightness.brightnessStatus === "too_dark") {
    recommendations.push("The photo is too dark. Move to a brighter area or turn on more light.");
  } else if (metrics.brightness.brightnessStatus === "too_bright") {
    recommendations.push("The photo is overexposed. Move away from direct light.");
  }

  if (metrics.glare.glareSeverity === "moderate" || metrics.glare.glareSeverity === "severe") {
    recommendations.push("Reduce glare on the page.");
    recommendations.push("Try tilting the document or stepping away from direct light to avoid reflections.");
  }

  if (metrics.perspective.perspectiveScore < weakScoreThreshold) {
    recommendations.push("Hold the phone more directly above the document.");
  }

  if (metrics.resolution.resolutionScore < weakScoreThreshold) {
    recommendations.push("Move the camera closer to the document.");
  }

  return recommendations;
}
