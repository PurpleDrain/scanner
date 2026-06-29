/**
 * Tunable parameters for the document-detection pipeline. Defaults were chosen empirically
 * against synthetic documents and the real low-contrast test photo (test_data/IMG_3004.jpg).
 * See DETECTION.md for the rationale behind each group.
 */

export interface ScoringWeights {
  edge: number;
  textDensity: number;
  area: number;
  aspectRatio: number;
  interiorConsistency: number;
}

export interface DetectionConfig {
  /** Longest-side processing dimension for "full" detection's base (100%) scale. */
  processMaxDim: number;
  /** Single processing dimension used in fast "preview" mode. */
  previewMaxDim: number;
  /** Multi-scale factors (of processMaxDim) tried in full mode, smallest→largest. */
  scales: number[];
  gaussianKernel: number;

  // Color-aware gradient (features/colorGradient.ts).
  /** Weight applied to a/b (chroma) channel gradients relative to L. Recovers color-only edges. */
  chromaWeight: number;

  // Hough transform (candidates/hough.ts).
  thetaBins: number;
  rhoBucket: number;
  voteAngleWindow: number; // radians; pixels vote only for line normals within this of their gradient
  magVoteFraction: number; // vote only where magnitude > fraction × maxMagnitude
  nmsThetaRadius: number;
  nmsRhoRadius: number;
  maxCandidateLines: number;
  minLineScoreFraction: number; // keep accumulator peaks above fraction × top peak
  maxLinesPerGroup: number; // cap per orientation group before quad enumeration

  // Quad enumeration (candidates/quads.ts).
  minQuadAreaFraction: number;
  maxQuadAreaFraction: number;
  maxCornerAngleDeviationDeg: number;
  cornerOutOfBoundsMargin: number; // fraction of frame a corner may fall outside
  edgeSamples: number; // samples per edge when integrating gradient along an edge

  // Scoring (scoring/).
  weights: ScoringWeights;
  /** Interior text density at/above which textDensity scores 1 (saturates). */
  textDensitySaturation: number;
  /** Plausible quad long/short side ratio (perspective-tolerant). A4≈1.41, Letter≈1.29. */
  aspectRatioRange: [number, number];

  // Text density (features/textDensity.ts).
  textGridCells: number; // density map resolution = grid of N×N cells
  adaptiveBlockSize: number; // odd; adaptiveThreshold neighbourhood
  adaptiveC: number;
  textCompMinFraction: number; // connected-component area band counted as "text" (fraction of frame)
  textCompMaxFraction: number;

  // Shadow-aware edges (features/shadowEdges.ts).
  shadowKernelFraction: number; // large Gaussian sigma as fraction of min(width,height)
  shadowWeight: number; // contribution of low-frequency response to the combined magnitude

  // Confidence (scoring/confidence.ts).
  confidenceScoreGapTarget: number; // score gap (winner − runner-up) that maps to full gap-confidence
}

export const DEFAULT_DETECTION_CONFIG: DetectionConfig = {
  processMaxDim: 320,
  previewMaxDim: 256,
  scales: [0.25, 0.5, 1.0],
  gaussianKernel: 5,

  chromaWeight: 7,

  thetaBins: 256,
  rhoBucket: 2,
  voteAngleWindow: 0.18,
  magVoteFraction: 0.12,
  nmsThetaRadius: 4,
  nmsRhoRadius: 6,
  maxCandidateLines: 60,
  minLineScoreFraction: 0.04,
  maxLinesPerGroup: 14,

  minQuadAreaFraction: 0.12,
  maxQuadAreaFraction: 0.99,
  maxCornerAngleDeviationDeg: 50,
  cornerOutOfBoundsMargin: 0.08,
  edgeSamples: 24,

  weights: {
    edge: 0.35,
    textDensity: 0.15,
    area: 0.25,
    aspectRatio: 0.1,
    interiorConsistency: 0.15,
  },
  /** Interior text density at/above which a quad is fully "document-like"; prevents the score
   *  from preferring a tight crop of the densest text over the complete page. */
  textDensitySaturation: 0.12,
  aspectRatioRange: [1.1, 1.8],

  textGridCells: 24,
  adaptiveBlockSize: 15,
  adaptiveC: 8,
  textCompMinFraction: 0.000005,
  textCompMaxFraction: 0.002,

  shadowKernelFraction: 0.04,
  // Shadow response is computed for debug/inspection but not folded into the Hough magnitude by
  // default: on low-contrast pages its broad low-frequency response tends to strengthen interior
  // text/region boundaries more than the faint page border. Raise to let it contribute votes.
  shadowWeight: 0,

  confidenceScoreGapTarget: 0.15,
};
