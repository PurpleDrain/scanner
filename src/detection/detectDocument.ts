import type { CV, Mat as CvMat } from "@techstark/opencv-js";
import { DEFAULT_DETECTION_CONFIG, type DetectionConfig } from "./config";
import { orderCorners, scaleQuad } from "./geometry";
import { detectMultiScale, detectPreviewMultiScale, type ScaleResult } from "./multiScale";
import { Profiler } from "./profiler";
import type { DetectionDebug, DetectionResult, DetectOptions, Quad } from "./types";

/**
 * Top-level document detector — the pipeline orchestrator.
 *
 * - "preview" mode (live frames): single-scale pass with color gradient, Hough, envelope
 *   candidate, and light edge refinement — tuned for responsiveness.
 * - "full" mode (capture): multi-scale search with surface candidates, confidence, and
 *   finest-scale refinement; optionally emits debug buffers.
 *
 * Returns corners in SOURCE-image coordinates, canonicalised to [TL, TR, BR, BL].
 */
export function detectDocument(
  cv: CV,
  src: CvMat,
  options: DetectOptions = {},
  config: DetectionConfig = DEFAULT_DETECTION_CONFIG,
): DetectionResult {
  const mode = options.mode ?? "preview";
  const debug = options.debug ?? false;
  const profiler = new Profiler();

  const winner: ScaleResult | null =
    mode === "full"
      ? detectMultiScale(cv, src, config, debug, profiler)
      : detectPreviewMultiScale(cv, src, config, debug, profiler);

  const timings = profiler.get();

  if (!winner || !winner.best) {
    return {
      quad: null,
      confidence: null,
      components: null,
      runnerUp: null,
      scale: 0,
      mode,
      timings,
      debug: debug && winner ? buildDebug(winner) : undefined,
    };
  }

  const { features, best, runnerUp, confidence } = winner;
  // Map feature-space corners back to source coordinates, then canonicalise corner order.
  const inv = 1 / features.scale;
  const srcCorners = scaleQuad(best.corners, inv, inv);
  const quad: Quad = orderCorners(srcCorners);

  return {
    quad,
    confidence,
    components: best.components,
    runnerUp,
    scale: features.scale,
    mode,
    timings,
    debug: debug ? buildDebug(winner) : undefined,
  };
}

function buildDebug(winner: ScaleResult): DetectionDebug {
  const { features, hough, scored } = winner;
  const heatmap =
    hough.accumulator && hough.rhoBins
      ? { width: hough.rhoBins, height: hough.stats.thetaBins, data: hough.accumulator }
      : undefined;
  return {
    featureMaps: features,
    lines: hough.lines,
    candidates: scored.slice(0, 8),
    accumulatorStats: hough.stats,
    accumulatorHeatmap: heatmap,
  };
}

/** Backward-compatible convenience: just the quad in source coordinates, or null. */
export function detectQuad(
  cv: CV,
  src: CvMat,
  options: DetectOptions = {},
  config: DetectionConfig = DEFAULT_DETECTION_CONFIG,
): Quad | null {
  return detectDocument(cv, src, options, config).quad;
}
