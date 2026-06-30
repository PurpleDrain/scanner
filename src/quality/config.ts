/**
 * Default thresholds for document quality assessment.
 *
 * These are engineering heuristics, not values derived from a labeled corpus of
 * Japanese medical documents. They are deliberately exposed as configuration so
 * they can be recalibrated once real pass/fail OCR or VLM outcomes are
 * available — see THRESHOLDS.md for the full rationale behind each value and
 * for the recommended recalibration procedure.
 */

export interface BlurThresholds {
  /** Variance-of-Laplacian at/above which the image is "excellent" (tack sharp). */
  excellentVariance: number;
  /** At/above which the image is "good". */
  goodVariance: number;
  /** At/above which the image is "acceptable" — OCR is still usually reliable. */
  acceptableVariance: number;
  /** At/above which the image is "poor" but may still partially OCR. Below this is "unusable". */
  poorVariance: number;
}

export interface BrightnessThresholds {
  /** Mean intensity (0-255) below which the image is classified "too_dark". */
  underexposedMean: number;
  /** Mean intensity (0-255) above which the image is classified "too_bright". */
  overexposedMean: number;
  /** Mean intensity considered ideal for a scanned page; the score peaks here. */
  idealMean: number;
}

export interface GlareThresholds {
  /** HSV "value" (0-255) above which a pixel is considered blown-out/bright. */
  brightnessThreshold: number;
  /** HSV "saturation" (0-255) below which a bright pixel is considered desaturated (glare, not just white paper). */
  saturationThreshold: number;
  /** Coverage % at/below which glare is "none". */
  noneCoveragePercent: number;
  /** Coverage % at/below which glare is "minor". */
  minorCoveragePercent: number;
  /** Coverage % at/below which glare is "moderate"; above this is "severe". */
  moderateCoveragePercent: number;
}

export interface PerspectiveThresholds {
  /** Mean corner-angle deviation (degrees) at/below which deviation scores 100. */
  excellentDeviationDegrees: number;
  /** Mean corner-angle deviation (degrees) at/above which deviation scores 0. */
  poorDeviationDegrees: number;
  /** Weight (0-1) of the angle-deviation component in the combined perspective score; the remainder is edge symmetry. */
  deviationWeight: number;
}

export interface ResolutionThresholds {
  /** Corrected document width (px) at/above which resolution scores 100. */
  excellentWidthPx: number;
  /** Corrected document width (px) at/above which resolution scores ~75. */
  goodWidthPx: number;
  /** Corrected document width (px) at/above which resolution scores ~50. */
  acceptableWidthPx: number;
  /** Corrected document width (px) at/above which resolution scores ~25. Below this scores fall toward 0. */
  poorWidthPx: number;
}

export interface QualityWeights {
  blur: number;
  glare: number;
  perspective: number;
  resolution: number;
}

export interface GradeThresholds {
  excellent: number;
  good: number;
  acceptable: number;
  poor: number;
}

export interface GuidanceConfig {
  /** A metric's score below this (0-100) is considered "weak" enough to warrant a recommendation. */
  weakScoreThreshold: number;
  /** Min share of the camera frame covered by the document; below → move-closer hint. */
  minFrameFill: number;
}

export interface QualityConfig {
  blur: BlurThresholds;
  brightness: BrightnessThresholds;
  glare: GlareThresholds;
  perspective: PerspectiveThresholds;
  resolution: ResolutionThresholds;
  weights: QualityWeights;
  overallGrade: GradeThresholds;
  guidance: GuidanceConfig;
}

export const DEFAULT_QUALITY_CONFIG: QualityConfig = {
  blur: {
    excellentVariance: 800,
    goodVariance: 400,
    acceptableVariance: 200,
    poorVariance: 80,
  },
  brightness: {
    underexposedMean: 90,
    overexposedMean: 245,
    idealMean: 175,
  },
  glare: {
    brightnessThreshold: 230,
    saturationThreshold: 60,
    noneCoveragePercent: 1,
    minorCoveragePercent: 5,
    moderateCoveragePercent: 15,
  },
  perspective: {
    excellentDeviationDegrees: 2,
    poorDeviationDegrees: 20,
    deviationWeight: 0.6,
  },
  resolution: {
    // Sized for dense Japanese text (kanji need more pixels per character than
    // Latin glyphs to keep strokes legible); see THRESHOLDS.md.
    excellentWidthPx: 2400,
    goodWidthPx: 1800,
    acceptableWidthPx: 1200,
    poorWidthPx: 800,
  },
  weights: {
    blur: 0.4,
    glare: 0.3,
    perspective: 0.2,
    resolution: 0.1,
  },
  overallGrade: {
    excellent: 90,
    good: 75,
    acceptable: 55,
    poor: 35,
  },
  guidance: {
    weakScoreThreshold: 70,
    minFrameFill: 0.12,
  },
};
