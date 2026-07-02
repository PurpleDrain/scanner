/** A 5-level severity scale reused by blur and the overall grade. */
export type QualityLevel = "excellent" | "good" | "acceptable" | "poor" | "unusable";

export type BrightnessStatus = "too_dark" | "good" | "too_bright";

export type GlareSeverity = "none" | "minor" | "moderate" | "severe";

export interface BlurMetric {
  /** Raw variance-of-Laplacian value. Higher = sharper. Unbounded. */
  blurVariance: number;
}

export interface BlurResult extends BlurMetric {
  /** 0-100, higher is better. */
  blurScore: number;
  blurSeverity: QualityLevel;
}

export interface BrightnessMetric {
  /** Mean pixel intensity (0-255) of the document region. */
  meanBrightness: number;
  /** Fraction (0-1) of pixels clipped near black (<10). */
  underexposedFraction: number;
  /** Fraction (0-1) of pixels clipped near white (>245). */
  overexposedFraction: number;
}

export interface BrightnessResult extends BrightnessMetric {
  brightnessScore: number;
  brightnessStatus: BrightnessStatus;
}

export interface GlareMetric {
  /** Percentage (0-100) of the document area covered by likely specular glare. */
  glareCoveragePercent: number;
}

export interface GlareResult extends GlareMetric {
  glareScore: number;
  glareSeverity: GlareSeverity;
}

export interface EdgeMetrics {
  topLength: number;
  bottomLength: number;
  leftLength: number;
  rightLength: number;
  /** Interior angle in degrees at each corner, in quad order [TL, TR, BR, BL]. */
  cornerAngles: [number, number, number, number];
  /** Mean absolute deviation of the four corner angles from 90 degrees. */
  cornerDeviation: number;
  /** 0-1, how close opposing edge pairs are in length (1 = perfectly symmetric). */
  edgeSymmetry: number;
}

export interface PerspectiveResult extends EdgeMetrics {
  perspectiveScore: number;
}

export interface ResolutionMetric {
  width: number;
  height: number;
}

export interface ResolutionResult extends ResolutionMetric {
  resolutionScore: number;
}

export interface DocumentQualityResult {
  overallScore: number;
  qualityGrade: QualityLevel;
  blur: BlurResult;
  brightness: BrightnessResult;
  glare: GlareResult;
  perspective: PerspectiveResult;
  resolution: ResolutionResult;
  recommendations: string[];
}
