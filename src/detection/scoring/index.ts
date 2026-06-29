import type { DetectionConfig } from "../config";
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
