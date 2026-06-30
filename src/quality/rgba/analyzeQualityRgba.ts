import type { Quad } from "../../documentScanner";
import { DEFAULT_QUALITY_CONFIG, type QualityConfig } from "../config";
import { computeEdgeMetrics } from "../metrics/perspective";
import { generateRecommendations } from "../recommendations";
import { scoreBlur } from "../scoring/blur";
import { scoreBrightness } from "../scoring/brightness";
import { scoreGlare } from "../scoring/glare";
import { computeOverallScore } from "../scoring/overall";
import { scorePerspective } from "../scoring/perspective";
import { scoreResolution } from "../scoring/resolution";
import type { DocumentQualityResult } from "../types";
import { computeBlurMetricRgba, computeBrightnessMetricRgba, computeGlareMetricRgba } from "./metrics";

/**
 * Document quality assessment over an already-warped RGBA crop, computed with
 * pure-JS pixel metrics plus the shared scoring/recommendation logic — so it
 * runs on the main thread with no OpenCV dependency. `width`/`height`
 * should be the NATIVE warp size (pre-export-upscale) so blur/resolution
 * reflect the true captured detail rather than interpolated pixels. `quad` is
 * the document's corners in source coordinates (for perspective scoring).
 */
export function analyzeQualityRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  quad: Quad,
  config: QualityConfig = DEFAULT_QUALITY_CONFIG,
): DocumentQualityResult {
  const blur = scoreBlur(computeBlurMetricRgba(data, width, height), config.blur);
  const brightness = scoreBrightness(computeBrightnessMetricRgba(data, width, height), config.brightness);
  const glare = scoreGlare(computeGlareMetricRgba(data, width, height, config.glare), config.glare);
  const perspective = scorePerspective(computeEdgeMetrics(quad), config.perspective);
  const resolution = scoreResolution({ width, height }, config.resolution);

  const { overallScore, qualityGrade } = computeOverallScore(
    {
      blurScore: blur.blurScore,
      glareScore: glare.glareScore,
      perspectiveScore: perspective.perspectiveScore,
      resolutionScore: resolution.resolutionScore,
    },
    config.weights,
    config.overallGrade,
  );

  const recommendations = generateRecommendations(
    { blur, brightness, glare, perspective, resolution },
    config.guidance,
  );

  return { overallScore, qualityGrade, blur, brightness, glare, perspective, resolution, recommendations };
}
