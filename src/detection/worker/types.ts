import type { Confidence, DetectionDebug, DetectionMode, DetectionParallelSources, Quad, ScoreComponents, ScoredCandidate, StageTimings } from "../types";

/** Serializable detection output (no OpenCV Mats). */
export interface WorkerDetectionResult {
  quad: Quad | null;
  confidence: Confidence | null;
  components: ScoreComponents | null;
  runnerUp: ScoredCandidate | null;
  scale: number;
  mode: DetectionMode;
  timings: StageTimings;
  debug?: DetectionDebug;
  /** Which path produced the final quad after parallel CV+ML fusion. */
  detector?: "cv" | "ml";
  /** Raw CV / ML outputs before fusion (debug). */
  sources?: DetectionParallelSources;
}

export interface WorkerDetectRequest {
  type: "detect";
  id: number;
  width: number;
  height: number;
  /** RGBA pixels; buffer is transferred from the main thread. */
  data: Uint8ClampedArray;
  mode: DetectionMode;
  profile: "live" | "capture";
  debug?: boolean;
}

export type WorkerReadyMessage = { type: "ready" };

export type WorkerResultMessage = {
  type: "result";
  id: number;
  result: WorkerDetectionResult;
};

export type WorkerErrorMessage = {
  type: "error";
  id: number;
  message: string;
};

export type WorkerOutboundMessage = WorkerReadyMessage | WorkerResultMessage | WorkerErrorMessage;

export type WorkerInboundMessage = WorkerDetectRequest;
