import type { DetectionConfig } from "../config";
import { quadSideLengths } from "../geometry";
import type { Candidate, FeatureMaps, ScoredCandidate } from "../types";
import { scoreComponents } from "./components";

export { scoreComponents, sampleField } from "./components";
export { computeConfidence } from "./confidence";

/** Scores every candidate quad and returns them sorted by total score, best first. */
export function scoreCandidates(
  maps: FeatureMaps,
  candidates: Candidate[],
  config: DetectionConfig,
): ScoredCandidate[] {
  const scored: ScoredCandidate[] = candidates.map((candidate) => {
    const components = scoreComponents(maps, candidate, config);
    return { ...candidate, components, score: components.total };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

/** Border-aware fit score — prefers tight page borders over desk-inclusive oversized quads. */
function fitScore(s: ScoredCandidate, config: DetectionConfig): number {
  const c = s.components;
  const areaPenalty = Math.max(0, c.area - config.maxFitArea) * 0.65;
  const shape = documentShapeScore(s, config);
  return (
    c.borderMargin * 0.22 +
    c.edge * 0.28 +
    c.envelopeSupport * 0.12 +
    shape * 0.18 +
    s.score * 0.1 +
    c.area * 0.1 -
    areaPenalty
  );
}

function documentShapeScore(s: ScoredCandidate, config: DetectionConfig): number {
  const { width, height } = quadSideLengths(s.corners);
  const short = Math.min(width, height);
  if (short === 0) return 0;
  const ratio = Math.max(width, height) / short;
  const [lo, hi] = config.documentAspectRange;
  if (ratio >= lo && ratio <= hi) return 1;
  const dist = ratio < lo ? lo - ratio : ratio - hi;
  return Math.max(0, 1 - dist / 0.35);
}

/**
 * Picks the document quad to track. Among near-top scorers, prefer a tight border fit over a
 * larger desk-inclusive envelope — while still allowing a genuinely larger page when its borders
 * score well.
 */
export function selectWinner(scored: ScoredCandidate[], config: DetectionConfig): ScoredCandidate | null {
  if (!scored.length) return null;
  const houghPick = scored[0];

  const contenders = scored.filter((s) => {
    const pageLike = s.components.area >= config.preferredMinArea && documentShapeScore(s, config) >= 0.45;
    return (
      (s.score >= houghPick.score - config.winnerScoreSlack ||
        (pageLike && s.score >= houghPick.score - config.winnerScoreSlack * 2.5)) &&
      (s.components.envelopeSupport >= config.minEnvelopeSupport || pageLike)
    );
  });
  if (contenders.length <= 1) return houghPick;

  const pageSized = contenders.filter(
    (s) => s.components.area >= config.preferredMinArea && documentShapeScore(s, config) >= 0.45,
  );
  const pool = pageSized.length ? pageSized : contenders;

  pool.sort((a, b) => fitScore(b, config) - fitScore(a, config));
  const bestFit = pool[0];

  if (bestFit === houghPick) return houghPick;

  const fitGain = fitScore(bestFit, config) - fitScore(houghPick, config);
  if (fitGain >= 0.025) return bestFit;

  if (
    bestFit.components.area > houghPick.components.area + config.minAreaGainForOuterWinner &&
    bestFit.components.borderMargin >= houghPick.components.borderMargin - 0.04 &&
    bestFit.components.envelopeSupport > houghPick.components.envelopeSupport + 0.06
  ) {
    return bestFit;
  }

  return houghPick;
}

/** Runner-up for confidence: best scored candidate that is not the winner. */
export function selectRunnerUp(scored: ScoredCandidate[], winner: ScoredCandidate | null): ScoredCandidate | null {
  if (!winner || scored.length < 2) return null;
  return scored.find((s) => s !== winner) ?? scored[1];
}
