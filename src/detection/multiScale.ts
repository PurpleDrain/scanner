import type { CV, Mat as CvMat } from "@techstark/opencv-js";
import type { DetectionConfig } from "./config";
import { findEnvelopeCandidate, findSurfaceCandidates, isDuplicateCandidate } from "./candidates/envelope";
import { houghLines, type HoughResult } from "./candidates/hough";
import { enumerateQuads } from "./candidates/quads";
import { extractFeatures } from "./features";
import { scaleQuad } from "./geometry";
import { refineQuadToEdges } from "./refineQuad";
import { computeConfidence, scoreCandidates, scoreComponents, selectRunnerUp, selectWinner } from "./scoring";
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
  longestSide: number;
}

function dimsFor(src: CvMat, longestSide: number): { width: number; height: number } {
  const longest = Math.max(src.cols, src.rows);
  const scale = longest > longestSide ? longestSide / longest : 1;
  return { width: Math.max(1, Math.round(src.cols * scale)), height: Math.max(1, Math.round(src.rows * scale)) };
}

function applyRefinement(features: FeatureMaps, best: ScoredCandidate, config: DetectionConfig): ScoredCandidate {
  const refinedCorners = refineQuadToEdges(features, best.corners, config);
  if (refinedCorners === best.corners) return best;
  const components = scoreComponents(features, { ...best, corners: refinedCorners }, config);
  return { ...best, corners: refinedCorners, components, score: components.total };
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
  const candidates = profiler.measure("candidates", () => {
    const fromLines = enumerateQuads(features, hough.lines, config);
    const envelope = findEnvelopeCandidate(cv, features, config);
    const all = [...fromLines];
    if (envelope && !all.some((c) => isDuplicateCandidate(c.corners, envelope.corners, features, config))) {
      all.push(envelope);
    }
    // Surface sweep is slow and targets upload scenes; skip in live preview.
    if (full) {
      for (const candidate of findSurfaceCandidates(cv, features, config)) {
        if (!all.some((c) => isDuplicateCandidate(c.corners, candidate.corners, features, config))) {
          all.push(candidate);
        }
      }
    }
    return all;
  });
  const scored = profiler.measure("scoring", () => scoreCandidates(features, candidates, config));

  let best = selectWinner(scored, config);
  if (best) best = applyRefinement(features, best, config);
  const runnerUp = selectRunnerUp(scored, best);
  const confidence = best ? computeConfidence(best, runnerUp, features, config) : null;

  return { features, hough, scored, best, runnerUp, confidence, longestSide };
}

function pickMultiScaleWinner(results: ScaleResult[]): ScaleResult | null {
  let winner: ScaleResult | null = null;
  for (const result of results) {
    if (!result.best) continue;
    const conf = result.confidence?.value ?? 0;
    const winnerConf = winner?.confidence?.value ?? 0;
    if (
      !winner ||
      conf > winnerConf + 0.025 ||
      (conf >= winnerConf - 0.025 && result.longestSide > winner.longestSide)
    ) {
      winner = result;
    }
  }
  return winner;
}

/**
 * Re-runs edge/corner refinement on the finest feature maps so borders land on the
 * highest-resolution gradient field.
 */
function refineAtFinestScale(
  cv: CV,
  src: CvMat,
  winner: ScaleResult,
  config: DetectionConfig,
  keepAccumulator: boolean,
  profiler: Profiler,
): ScaleResult {
  if (!config.finalRefineAtMaxScale || !winner.best) return winner;

  const finestSide = Math.max(32, config.processMaxDim);
  if (winner.longestSide >= finestSide) return winner;

  const finest = detectAtScale(cv, src, finestSide, config, true, keepAccumulator, profiler);
  const ratio = winner.features.scale / finest.features.scale;
  const seed = scaleQuad(winner.best.corners, ratio, ratio);
  const refined = refineQuadToEdges(finest.features, seed, config);
  const components = scoreComponents(finest.features, { ...winner.best, corners: refined }, config);
  const refinedBest: ScoredCandidate = {
    ...winner.best,
    corners: refined,
    components,
    score: components.total,
  };

  let best = refinedBest;
  if (finest.best && finest.best.score > refinedBest.score + 0.02) {
    best = applyRefinement(finest.features, finest.best, config);
  }

  const runnerUp = selectRunnerUp(finest.scored, best);
  return {
    ...finest,
    best,
    runnerUp,
    confidence: computeConfidence(best, runnerUp, finest.features, config),
    longestSide: finestSide,
  };
}

/** Multi-scale detection with finest-scale preference and max-resolution refinement. */
export function detectMultiScale(
  cv: CV,
  src: CvMat,
  config: DetectionConfig,
  keepAccumulator: boolean,
  profiler: Profiler,
): ScaleResult | null {
  const results: ScaleResult[] = [];
  for (const factor of config.scales) {
    const longestSide = Math.max(32, Math.round(config.processMaxDim * factor));
    results.push(detectAtScale(cv, src, longestSide, config, true, keepAccumulator, profiler));
  }
  const winner = pickMultiScaleWinner(results);
  if (!winner?.best) return winner;
  return refineAtFinestScale(cv, src, winner, config, keepAccumulator, profiler);
}

/** Multi-scale preview search for live frames. */
export function detectPreviewMultiScale(
  cv: CV,
  src: CvMat,
  config: DetectionConfig,
  keepAccumulator: boolean,
  profiler: Profiler,
): ScaleResult | null {
  const results: ScaleResult[] = [];
  for (const factor of config.previewScales) {
    const longestSide = Math.max(32, Math.round(config.previewMaxDim * factor));
    results.push(detectAtScale(cv, src, longestSide, config, false, keepAccumulator, profiler));
  }
  const winner = pickMultiScaleWinner(results);
  if (!winner?.best) return winner;
  return refineAtFinestScale(
    cv,
    src,
    winner,
    { ...config, processMaxDim: config.previewMaxDim },
    keepAccumulator,
    profiler,
  );
}
