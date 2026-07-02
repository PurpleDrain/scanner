import { describe, expect, it } from "vitest";
import { computeOverallScore } from "../scoring/overall";
import { DEFAULT_QUALITY_CONFIG } from "../config";

describe("computeOverallScore", () => {
  const { weights, overallGrade } = DEFAULT_QUALITY_CONFIG;

  it("computes the weighted average of blur/glare/perspective/resolution", () => {
    const { overallScore } = computeOverallScore(
      { blurScore: 100, glareScore: 100, perspectiveScore: 100, resolutionScore: 100 },
      weights,
      overallGrade,
    );
    expect(overallScore).toBe(100);
  });

  it("ignores brightness entirely (weights sum to 1 across the other four)", () => {
    const { overallScore } = computeOverallScore(
      { blurScore: 80, glareScore: 80, perspectiveScore: 80, resolutionScore: 80 },
      weights,
      overallGrade,
    );
    expect(overallScore).toBe(80);
  });

  it("weights each component proportionally to its configured weight", () => {
    const { overallScore } = computeOverallScore(
      { blurScore: 100, glareScore: 0, perspectiveScore: 0, resolutionScore: 0 },
      weights,
      overallGrade,
    );
    expect(overallScore).toBe(Math.round(100 * weights.blur));
  });

  it("grades at/above the excellent threshold as excellent", () => {
    const { qualityGrade } = computeOverallScore(
      { blurScore: 100, glareScore: 100, perspectiveScore: 100, resolutionScore: 100 },
      weights,
      overallGrade,
    );
    expect(qualityGrade).toBe("excellent");
  });

  it("grades below the poor threshold as unusable", () => {
    const { qualityGrade } = computeOverallScore(
      { blurScore: 10, glareScore: 10, perspectiveScore: 10, resolutionScore: 10 },
      weights,
      overallGrade,
    );
    expect(qualityGrade).toBe("unusable");
  });

  it("is monotonically non-decreasing in each component score", () => {
    const samples = [0, 25, 50, 75, 100];
    const scores = samples.map(
      (s) => computeOverallScore({ blurScore: s, glareScore: s, perspectiveScore: s, resolutionScore: s }, weights, overallGrade).overallScore,
    );
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
  });
});
