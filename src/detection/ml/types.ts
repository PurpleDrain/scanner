import type { Quad, StageTimings } from "../types";

export interface MlDetectionResult {
  quad: Quad | null;
  /** 0..1 aggregate heatmap confidence (mean peak per corner channel). */
  confidence: number;
  timings: StageTimings;
}

export interface MlDetectRequest {
  type: "detect";
  id: number;
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export type MlReadyMessage = { type: "ready" };
export type MlUnavailableMessage = { type: "unavailable"; message: string };

export type MlResultMessage = {
  type: "result";
  id: number;
  result: MlDetectionResult;
};

export type MlErrorMessage = {
  type: "error";
  id: number;
  message: string;
};

export type MlOutboundMessage = MlReadyMessage | MlUnavailableMessage | MlResultMessage | MlErrorMessage;
export type MlInboundMessage = MlDetectRequest;
