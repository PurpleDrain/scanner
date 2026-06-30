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
  envelopeSupport: number;
  borderMargin: number;
}

export interface DetectionConfig {
  /** Longest-side processing dimension for "full" detection's base (100%) scale. */
  processMaxDim: number;
  /** Single processing dimension used in fast "preview" mode. */
  previewMaxDim: number;
  /** Multi-scale factors (of processMaxDim) tried in full mode, smallest→largest. */
  scales: number[];
  /** Preview-mode scale factors (of previewMaxDim) for live / fast detection. */
  previewScales: number[];
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

  // Border-margin scoring (scoring/components.ts) — rejects interior text lines & overshoot.
  borderStripWidth: number; // px in feature space; offset for inner/outer strip samples
  maxBorderSearch: number; // px to search outward/inward for a stronger parallel edge
  outwardEdgeRatio: number; // parallel peak / edge mag above which the border is penalised
  topMarginTextThreshold: number; // inner-strip text density above which the top edge is penalised
  exteriorTextThreshold: number; // outer-strip text density above which the bottom edge is penalised

  // Envelope contour candidate (candidates/envelope.ts) + winner re-ranking.
  envelopeMaskThreshold: number; // combined color/shadow normalised level for the blob mask
  envelopeColorWeight: number;
  envelopeShadowWeight: number;
  envelopeMorphKernelFraction: number;
  envelopeDuplicateFraction: number; // mean corner distance (fraction of min dim) to treat as duplicate
  envelopeShadowScoreWeight: number; // envelopeSupport: shadow vs color along the border
  minEnvelopeSupport: number; // minimum envelopeSupport to compete in outer-quad re-ranking
  winnerScoreSlack: number; // allow picking a larger quad within this score gap of the top Hough pick
  preferredMinArea: number; // prefer winners at/above this area fraction when envelope is strong
  minAreaGainForOuterWinner: number; // area gain needed to override a tighter top-scored candidate
  /** Penalise winner re-ranking when area exceeds this fraction (oversized desk-inclusive quads). */
  maxFitArea: number;
  /** Long/short ratio for normal document pages; used to reject square interior text blocks. */
  documentAspectRange: [number, number];

  // Post-selection edge snap (refineQuad.ts).
  edgeRefineSearch: number; // px in feature space to search along each edge normal
  edgeRefineStep: number;
  edgeRefinePasses: number;
  /** 2-D corner search radius (px) after edge refinement. */
  edgeRefineCornerRadius: number;
  /** Re-snap the winning quad on the finest-scale feature maps after multi-scale search. */
  finalRefineAtMaxScale: boolean;
}

export const DEFAULT_DETECTION_CONFIG: DetectionConfig = {
  processMaxDim: 1920,
  previewMaxDim: 640,
  scales: [0.5, 0.75, 1.0],
  previewScales: [1.0],
  gaussianKernel: 5,

  chromaWeight: 8,

  thetaBins: 256,
  rhoBucket: 2,
  voteAngleWindow: 0.16,
  magVoteFraction: 0.1,
  nmsThetaRadius: 3,
  nmsRhoRadius: 5,
  maxCandidateLines: 72,
  minLineScoreFraction: 0.03,
  maxLinesPerGroup: 18,

  minQuadAreaFraction: 0.1,
  maxQuadAreaFraction: 0.99,
  maxCornerAngleDeviationDeg: 55,
  cornerOutOfBoundsMargin: 0.1,
  edgeSamples: 32,

  weights: {
    edge: 0.28,
    textDensity: 0.12,
    area: 0.2,
    aspectRatio: 0.08,
    interiorConsistency: 0.12,
    envelopeSupport: 0.1,
    borderMargin: 0.1,
  },
  textDensitySaturation: 0.12,
  aspectRatioRange: [1.0, 2.5],

  textGridCells: 28,
  adaptiveBlockSize: 15,
  adaptiveC: 8,
  textCompMinFraction: 0.000005,
  textCompMaxFraction: 0.002,

  shadowKernelFraction: 0.035,
  shadowWeight: 0,

  confidenceScoreGapTarget: 0.14,

  borderStripWidth: 6,
  maxBorderSearch: 40,
  outwardEdgeRatio: 0.4,
  topMarginTextThreshold: 0.12,
  exteriorTextThreshold: 0.06,

  envelopeMaskThreshold: 0.15,
  envelopeColorWeight: 0.4,
  envelopeShadowWeight: 0.6,
  envelopeMorphKernelFraction: 0.025,
  envelopeDuplicateFraction: 0.05,
  envelopeShadowScoreWeight: 0.68,
  minEnvelopeSupport: 0.14,
  winnerScoreSlack: 0.06,
  preferredMinArea: 0.18,
  minAreaGainForOuterWinner: 0.16,
  maxFitArea: 0.62,
  documentAspectRange: [1.2, 1.9],

  edgeRefineSearch: 40,
  edgeRefineStep: 1,
  edgeRefinePasses: 3,
  edgeRefineCornerRadius: 18,
  finalRefineAtMaxScale: true,
};
