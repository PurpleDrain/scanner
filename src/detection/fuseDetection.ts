import type { Confidence, DetectionMode, DetectionParallelSources, DetectionSourceSummary, StageTimings } from "./types";
import { scaleQuad } from "./geometry";
import type { MlDetectionResult } from "./ml/types";
import type { Quad } from "./types";
import type { WorkerDetectionResult } from "./worker/types";

/** Minimum ML heatmap confidence to trust the model over CV. */
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

function withMlTimings(cv: WorkerDetectionResult, ml: MlDetectionResult | null): StageTimings {
  return {
    ...cv.timings,
    ...(ml?.timings ?? {}),
  };
}

function buildSources(cv: WorkerDetectionResult, ml: MlDetectionResult | null): DetectionParallelSources {
  return {
    cv: {
      quad: cv.quad,
      confidence: cv.confidence?.value ?? null,
      timings: cv.timings,
      components: cv.components,
    },
    ml: ml
      ? {
          quad: ml.quad,
          confidence: ml.confidence,
          timings: ml.timings,
        }
      : null,
  };
}

function mlResultToWorker(
  cv: WorkerDetectionResult,
  ml: MlDetectionResult,
  timings: StageTimings,
  sources: DetectionParallelSources,
): WorkerDetectionResult {
  return {
    ...cv,
    quad: ml.quad,
    confidence: mlToConfidence(ml.confidence),
    components: null,
    runnerUp: null,
    timings,
    detector: "ml",
    sources,
  };
}

/**
 * Picks the quad when CV and ML run in parallel.
 * ML is preferred whenever it returns a usable quad; CV is the fallback.
 */
export function fuseDetection(
  cv: WorkerDetectionResult,
  ml: MlDetectionResult | null,
): WorkerDetectionResult {
  const timings = withMlTimings(cv, ml);
  const sources = buildSources(cv, ml);
  const mlUsable = Boolean(ml?.quad && (ml.confidence ?? 0) >= ML_MIN_CONFIDENCE);

  if (mlUsable) {
    return mlResultToWorker(cv, ml!, timings, sources);
  }

  return { ...cv, timings, detector: "cv", sources };
}

export function emptyMlResult(mode: DetectionMode): WorkerDetectionResult {
  return {
    quad: null,
    confidence: null,
    components: null,
    runnerUp: null,
    scale: 0,
    mode,
    timings: {},
    detector: "cv",
  };
}

/** Map detection coordinates (e.g. downscaled live frame) back to source/video space. */
export function scaleWorkerResult(
  result: WorkerDetectionResult,
  factorX: number,
  factorY: number,
): WorkerDetectionResult {
  const scaleQ = (quad: Quad | null) => (quad ? scaleQuad(quad, factorX, factorY) : null);
  const scaleSource = (source: DetectionSourceSummary | null): DetectionSourceSummary | null =>
    source ? { ...source, quad: scaleQ(source.quad) } : null;

  return {
    ...result,
    quad: scaleQ(result.quad),
    sources: result.sources
      ? {
          cv: { ...result.sources.cv, quad: scaleQ(result.sources.cv.quad) },
          ml: scaleSource(result.sources.ml),
        }
      : undefined,
  };
}

/** Live preview path: ML-only worker result (CV not run). */
export function mlToLiveWorkerResult(ml: MlDetectionResult): WorkerDetectionResult {
  const cvShell: WorkerDetectionResult = {
    quad: null,
    confidence: null,
    components: null,
    runnerUp: null,
    scale: 1,
    mode: "preview",
    timings: {},
  };
  return fuseDetection(cvShell, ml);
}
