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
import {
  computeBlurMetricRgba,
  computeBlurMetricRgbaSourceRegion,
  computeBrightnessMetricRgba,
  computeGlareMetricRgba,
} from "./metrics";

export interface AnalyzeQualitySource {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/**
 * Document quality assessment over an already-warped RGBA crop, computed with
 * pure-JS pixel metrics plus the shared scoring/recommendation logic — so it
 * runs on the main thread with no OpenCV dependency. `width`/`height`
 * should be the NATIVE warp size (pre-export-upscale) so resolution reflects
 * the true captured detail. Pass `source` to measure blur on the original
 * photo region (before warp interpolation softens edges). `quad` is the
 * document's corners in source coordinates (for perspective scoring and blur crop).
 */
export function analyzeQualityRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  quad: Quad,
  config: QualityConfig = DEFAULT_QUALITY_CONFIG,
  source?: AnalyzeQualitySource,
): DocumentQualityResult {
  const blurMetric = source
    ? computeBlurMetricRgbaSourceRegion(source.data, source.width, source.height, quad)
    : computeBlurMetricRgba(data, width, height);
  const blur = scoreBlur(blurMetric, config.blur);
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
