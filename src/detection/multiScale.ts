import type { CV, Mat as CvMat } from "@techstark/opencv-js";
import type { DetectionConfig } from "./config";
import { houghLines, type HoughResult } from "./candidates/hough";
import { enumerateQuads } from "./candidates/quads";
import { extractFeatures } from "./features";
import { computeConfidence, scoreCandidates } from "./scoring";
import type { Confidence, FeatureMaps, ScoredCandidate } from "./types";
import type { Profiler } from "./profiler";

/** Result of running the pipeline once at a single processing scale. */
export interface ScaleResult {
  features: FeatureMaps;
  hough: HoughResult;
  scored: ScoredCandidate[];
  best: ScoredCandidate | null;
  runnerUp: ScoredCandidate | null;
  confidence: Confidence | null;
}

function dimsFor(src: CvMat, longestSide: number): { width: number; height: number } {
  const longest = Math.max(src.cols, src.rows);
  const scale = longest > longestSide ? longestSide / longest : 1;
  return { width: Math.max(1, Math.round(src.cols * scale)), height: Math.max(1, Math.round(src.rows * scale)) };
}

/** Runs feature extraction → candidate generation → scoring at one scale. */
export function detectAtScale(
  cv: CV,
  src: CvMat,
  longestSide: number,
  config: DetectionConfig,
  full: boolean,
  keepAccumulator: boolean,
  profiler: Profiler,
): ScaleResult {
  const { width, height } = dimsFor(src, longestSide);

  const features = profiler.measure("features", () => extractFeatures(cv, src, width, height, config, full));
  const hough = profiler.measure("hough", () => houghLines(features, config, keepAccumulator));
  const candidates = profiler.measure("candidates", () => enumerateQuads(features, hough.lines, config));
  const scored = profiler.measure("scoring", () => scoreCandidates(features, candidates, config));

  const best = scored[0] ?? null;
  const runnerUp = scored[1] ?? null;
  const confidence = best ? computeConfidence(best, runnerUp, features, config) : null;

  return { features, hough, scored, best, runnerUp, confidence };
}

/**
 * Multi-scale detection (spec section 5): runs the pipeline at several fractions of the base
 * processing dimension and keeps the scale whose winning candidate has the highest confidence.
 * Small scales suppress interior text and find large/near documents; the full scale localises
 * edges precisely. Confidence is comparable across scales (all components are scale-invariant
 * fractions), so it is a sound basis for reconciliation.
 */
export function detectMultiScale(
  cv: CV,
  src: CvMat,
  config: DetectionConfig,
  keepAccumulator: boolean,
  profiler: Profiler,
): ScaleResult | null {
  let winner: ScaleResult | null = null;
  for (const factor of config.scales) {
    const longestSide = Math.max(32, Math.round(config.processMaxDim * factor));
    const result = detectAtScale(cv, src, longestSide, config, true, keepAccumulator, profiler);
    if (!result.best) continue;
    if (!winner || (result.confidence?.value ?? 0) > (winner.confidence?.value ?? 0)) {
      winner = result;
    }
  }
  return winner;
}
