import { DEFAULT_DETECTION_CONFIG, type DetectionConfig } from "./config";

/**
 * Live webcam worker — single-scale preview at moderate resolution.
 * Envelope + Hough only (no surface sweep); no extra finest-scale pass.
 */
export const LIVE_WORKER_CONFIG: DetectionConfig = {
  ...DEFAULT_DETECTION_CONFIG,
  previewMaxDim: 640,
  previewScales: [1.0],
  finalRefineAtMaxScale: false,
  edgeRefinePasses: 2,
  edgeRefineSearch: 32,
  edgeRefineCornerRadius: 14,
  maxCandidateLines: 64,
  maxLinesPerGroup: 16,
  thetaBins: 256,
  textGridCells: 24,
};

/**
 * Capture / upload worker — multi-scale search at native-ish resolution with
 * finest-scale edge snap. Surface candidates help when text edges dominate.
 */
export const CAPTURE_WORKER_CONFIG: DetectionConfig = {
  ...DEFAULT_DETECTION_CONFIG,
  processMaxDim: 2560,
  scales: [0.45, 0.7, 0.9, 1.0],
  finalRefineAtMaxScale: true,
  edgeRefinePasses: 4,
  edgeRefineSearch: 48,
  edgeRefineCornerRadius: 22,
  maxCandidateLines: 96,
  maxLinesPerGroup: 22,
  edgeSamples: 48,
  textGridCells: 32,
};
