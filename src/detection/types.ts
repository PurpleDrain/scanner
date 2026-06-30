/**
 * Shared types for the document-detection pipeline.
 *
 * The pipeline is split into four stages so that future ML components can replace any one of
 * them behind a stable interface: feature extraction (→ {@link FeatureMaps}), candidate
 * generation (→ {@link Candidate}), candidate scoring (→ {@link ScoredCandidate}), and
 * perspective correction (consumes the final {@link Quad}).
 */

export interface Point {
  x: number;
  y: number;
}

/** The four corners of a document, in [top-left, top-right, bottom-right, bottom-left] order. */
export type Quad = [Point, Point, Point, Point];

/** A line in Hesse normal form: rho = x·cos(theta) + y·sin(theta), in feature-map coordinates. */
export interface Line {
  theta: number; // radians, [0, π)
  rho: number; // signed distance from origin
  cos: number;
  sin: number;
  score: number; // accumulated gradient magnitude (Hough vote total)
}

/** A candidate document quadrilateral plus the four lines that generated it, in feature-map space. */
export interface Candidate {
  corners: Quad; // polygon-traversal order (not yet canonicalised to TL/TR/BR/BL)
  lines: [Line, Line, Line, Line];
}

/** Individual scoring components (each 0..1) and their weighted total. */
export interface ScoreComponents {
  edge: number;
  textDensity: number;
  area: number;
  aspectRatio: number;
  interiorConsistency: number;
  /** Mean shadow + color response along the quad border (page outline in debug maps). */
  envelopeSupport: number;
  borderMargin: number;
  total: number;
}

export interface ScoredCandidate extends Candidate {
  components: ScoreComponents;
  score: number; // === components.total
}

/** Detection confidence (0..1) and the factors that compose it. */
export interface Confidence {
  value: number;
  edgeStrength: number;
  quadValidity: number;
  scoreGap: number; // separation from the runner-up candidate
  textDensity: number;
  geometricPlausibility: number;
}

/**
 * Per-pixel feature maps at one processing scale. Typed arrays are row-major, length width*height.
 * Heavy fields (text density, shadow, Lab channels) are only populated in "full" detection mode.
 */
export interface FeatureMaps {
  width: number;
  height: number;
  scale: number; // featureMapSize / srcSize — multiply feature coords by 1/scale to map back to src

  // Color-aware combined gradient (chroma-weighted across L, a, b).
  magnitude: Float32Array;
  direction: Float32Array; // radians, atan2(gy, gx) of the dominant-channel gradient
  maxMagnitude: number;

  // Per-channel gradient magnitudes (debug + multi-channel inspection).
  magnitudeL: Float32Array;
  magnitudeA: Float32Array;
  magnitudeB: Float32Array;

  // Text-density and shadow (low-frequency page outline).
  textDensity?: Float32Array; // 0..1 local text likelihood
  shadow?: Float32Array; // low-frequency (shadow) edge response
  shadowMax?: number;
  labL?: Float32Array; // retained Lab channels for interior-consistency scoring
  labA?: Float32Array;
  labB?: Float32Array;
}

export type DetectionMode = "preview" | "full";

export interface StageTimings {
  [stage: string]: number; // milliseconds
}

/** Diagnostic data emitted when detection is run with `debug: true` (capture mode only). */
export interface DetectionDebug {
  featureMaps: FeatureMaps;
  lines: Line[];
  candidates: ScoredCandidate[]; // top-N, best first
  accumulatorStats: { peak: number; peakCount: number; thetaBins: number; rhoBins: number };
  accumulatorHeatmap?: { width: number; height: number; data: Float32Array };
}

export interface DetectionResult {
  quad: Quad | null; // canonical TL/TR/BR/BL in SOURCE coordinates, or null if nothing found
  confidence: Confidence | null;
  components: ScoreComponents | null;
  runnerUp: ScoredCandidate | null;
  scale: number; // processing scale that produced the winner
  mode: DetectionMode;
  timings: StageTimings;
  debug?: DetectionDebug;
  /** Present when CV and ML ran in parallel; indicates which path won fusion. */
  detector?: "cv" | "ml";
  /** Raw CV / ML outputs before fusion (debug). */
  sources?: DetectionParallelSources;
}

/** Per-path detection snapshot for parallel CV+ML debug. */
export interface DetectionSourceSummary {
  quad: Quad | null;
  confidence: number | null;
  timings: StageTimings;
  components?: ScoreComponents | null;
}

export interface DetectionParallelSources {
  cv: DetectionSourceSummary;
  ml: DetectionSourceSummary | null;
}

export interface DetectOptions {
  mode?: DetectionMode; // "preview" (fast, single scale) | "full" (multi-scale + interior scoring)
  debug?: boolean; // build DetectionDebug buffers (full mode)
}
