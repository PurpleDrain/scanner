import type { Confidence, DetectionMode, Quad } from "./types";
import { scaleQuad } from "./geometry";
import type { MlDetectionResult } from "./ml/types";
import type { WorkerDetectionResult } from "./worker/types";

/** Minimum ML heatmap confidence to trust a detection. */
const ML_MIN_CONFIDENCE = 0.2;

function mlToConfidence(value: number): Confidence {
  return {
    value,
    edgeStrength: value,
    quadValidity: 0.75,
    scoreGap: 1,
    textDensity: 0,
    geometricPlausibility: 0.75,
  };
}

/** Wraps a raw ML detection into the worker-result shape consumed by the tracker/UI. */
export function mlToWorkerResult(ml: MlDetectionResult, mode: DetectionMode = "preview"): WorkerDetectionResult {
  const usable = Boolean(ml.quad && ml.confidence >= ML_MIN_CONFIDENCE);
  return {
    quad: usable ? ml.quad : null,
    confidence: usable ? mlToConfidence(ml.confidence) : null,
    components: null,
    runnerUp: null,
    scale: 1,
    mode,
    timings: ml.timings,
    detector: "ml",
  };
}

/** Map detection coordinates (e.g. a downscaled live frame) back to source/video space. */
export function scaleWorkerResult(
  result: WorkerDetectionResult,
  factorX: number,
  factorY: number,
): WorkerDetectionResult {
  const scaleQ = (quad: Quad | null) => (quad ? scaleQuad(quad, factorX, factorY) : null);
  return { ...result, quad: scaleQ(result.quad) };
}
