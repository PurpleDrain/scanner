export { analyzeDocumentQuality } from "./analyzeDocumentQuality";
export { DEFAULT_QUALITY_CONFIG } from "./config";
export type {
  QualityConfig,
  BlurThresholds,
  BrightnessThresholds,
  GlareThresholds,
  PerspectiveThresholds,
  ResolutionThresholds,
  QualityWeights,
  GradeThresholds,
  GuidanceConfig,
} from "./config";
export type {
  QualityLevel,
  BrightnessStatus,
  GlareSeverity,
  DetectedDocument,
  BlurResult,
  BrightnessResult,
  GlareResult,
  PerspectiveResult,
  ResolutionResult,
  EdgeMetrics,
  DocumentQualityResult,
} from "./types";

// Pure metric/scoring building blocks, exported for composability and testing.
export { computeBlurMetric } from "./metrics/blur";
export { computeBrightnessMetric } from "./metrics/brightness";
export { computeGlareMetric } from "./metrics/glare";
export { computeEdgeMetrics } from "./metrics/perspective";
export { computeResolutionMetric } from "./metrics/resolution";
export { scoreBlur } from "./scoring/blur";
export { scoreBrightness } from "./scoring/brightness";
export { scoreGlare } from "./scoring/glare";
export { scorePerspective } from "./scoring/perspective";
export { scoreResolution } from "./scoring/resolution";
export { computeOverallScore } from "./scoring/overall";
export { generateRecommendations } from "./recommendations";
