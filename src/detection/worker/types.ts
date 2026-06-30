import type { Confidence, DetectionMode, Quad, ScoreComponents, ScoredCandidate, StageTimings } from "../types";

/** Serializable detection output from the ML worker. */
export interface WorkerDetectionResult {
  quad: Quad | null;
  confidence: Confidence | null;
  components: ScoreComponents | null;
  runnerUp: ScoredCandidate | null;
  scale: number;
  mode: DetectionMode;
  timings: StageTimings;
  /** Which path produced the final quad. */
  detector?: "ml";
}
