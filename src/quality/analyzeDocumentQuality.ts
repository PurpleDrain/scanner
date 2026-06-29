import type { CV, Mat as CvMat } from "@techstark/opencv-js";
import { warpDocument } from "../documentScanner";
import { DEFAULT_QUALITY_CONFIG, type QualityConfig } from "./config";
import { toGray } from "./metrics/colorUtils";
import { computeBlurMetric } from "./metrics/blur";
import { computeBrightnessMetric } from "./metrics/brightness";
import { computeGlareMetric } from "./metrics/glare";
import { computeEdgeMetrics } from "./metrics/perspective";
import { computeResolutionMetric } from "./metrics/resolution";
import { scoreBlur } from "./scoring/blur";
import { scoreBrightness } from "./scoring/brightness";
import { scoreGlare } from "./scoring/glare";
import { scorePerspective } from "./scoring/perspective";
import { scoreResolution } from "./scoring/resolution";
import { computeOverallScore } from "./scoring/overall";
import { generateRecommendations } from "./recommendations";
import type { DetectedDocument, DocumentQualityResult } from "./types";

/**
 * Estimates whether a captured/uploaded document photo is likely to be
 * successfully processed by OCR or a vision-language model — not whether it
 * is aesthetically pleasing.
 *
 * `image` is the full source frame (the same Mat that document boundary
 * detection ran on); `detectedDocument.quad` are that frame's four detected
 * corners. This function performs its own perspective warp internally (via
 * the same `warpDocument` used for the final export) so blur/brightness/
 * glare/resolution are all measured on the corrected document crop, not on
 * background clutter outside the page.
 */
export function analyzeDocumentQuality(
  cv: CV,
  image: CvMat,
  detectedDocument: DetectedDocument,
  config: QualityConfig = DEFAULT_QUALITY_CONFIG,
): DocumentQualityResult {
  const corrected = warpDocument(cv, image, detectedDocument.quad);
  const gray = toGray(cv, corrected);
  try {
    const blur = scoreBlur(computeBlurMetric(cv, gray), config.blur);
    const brightness = scoreBrightness(computeBrightnessMetric(cv, gray), config.brightness);
    const glare = scoreGlare(computeGlareMetric(cv, corrected, config.glare), config.glare);
    const perspective = scorePerspective(computeEdgeMetrics(detectedDocument.quad), config.perspective);
    const resolution = scoreResolution(computeResolutionMetric(corrected), config.resolution);

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
  } finally {
    gray.delete();
    corrected.delete();
  }
}
