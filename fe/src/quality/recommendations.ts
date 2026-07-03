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
export const REC_BLURRY = "画像がぶれています。スマホをしっかり固定して、もう一度お試しください。";
export const REC_TOO_DARK = "少し暗く写っています。明るい場所に移動するか、照明を足していただけますか。";
export const REC_TOO_BRIGHT = "明るすぎて白く飛んでいます。直接の光を避けて撮影してください。";
export const REC_GLARE = "紙に光が反射しています。";
export const REC_GLARE_TIP = "書類の角度を少し変えるか、直接の光から離れると反射を抑えられます。";
export const REC_PERSPECTIVE = "書類の真上からまっすぐ撮影すると、より正確に読み取れます。";
export const REC_RESOLUTION = "もう少しカメラを書類に近づけて撮影してください。";

export function generateRecommendations(metrics: QualityMetricResults, guidance: GuidanceConfig): string[] {
  const recommendations: string[] = [];
  const { weakScoreThreshold } = guidance;

  if (metrics.blur.blurScore < weakScoreThreshold) {
    recommendations.push(REC_BLURRY);
  }

  if (metrics.brightness.brightnessStatus === "too_dark") {
    recommendations.push(REC_TOO_DARK);
  } else if (metrics.brightness.brightnessStatus === "too_bright") {
    recommendations.push(REC_TOO_BRIGHT);
  }

  if (metrics.glare.glareSeverity === "moderate" || metrics.glare.glareSeverity === "severe") {
    recommendations.push(REC_GLARE);
    recommendations.push(REC_GLARE_TIP);
  }

  if (metrics.perspective.perspectiveScore < weakScoreThreshold) {
    recommendations.push(REC_PERSPECTIVE);
  }

  if (metrics.resolution.resolutionScore < weakScoreThreshold) {
    recommendations.push(REC_RESOLUTION);
  }

  return recommendations;
}
