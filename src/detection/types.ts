/**
 * Shared types for the document-detection pipeline. Detection is performed by the
 * ML model (DocAligner) in a worker; these types describe its serializable output
 * and the tracked {@link Quad} consumed by perspective correction.
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

export type DetectionMode = "preview" | "full";

export interface StageTimings {
  [stage: string]: number; // milliseconds
}

export interface DetectionResult {
  quad: Quad | null; // canonical TL/TR/BR/BL in SOURCE coordinates, or null if nothing found
  confidence: Confidence | null;
  components: ScoreComponents | null;
  runnerUp: ScoredCandidate | null;
  scale: number; // processing scale that produced the winner
  mode: DetectionMode;
  timings: StageTimings;
  /** Which path produced the final quad. */
  detector?: "ml";
}
