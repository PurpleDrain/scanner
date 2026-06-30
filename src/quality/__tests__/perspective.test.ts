import { describe, expect, it } from "vitest";
import { computeEdgeMetrics } from "../metrics/perspective";
import { scorePerspective } from "../scoring/perspective";
import { DEFAULT_QUALITY_CONFIG } from "../config";
import type { Quad } from "../../documentScanner";

/** Axis-aligned rectangle in TL, TR, BR, BL order. */
function axisAlignedQuad(width: number, height: number): Quad {
  return [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ];
}

describe("computeEdgeMetrics", () => {
  it("reports zero deviation and perfect symmetry for an axis-aligned rectangle", () => {
    const quad = axisAlignedQuad(800, 600);
    const metrics = computeEdgeMetrics(quad);
    expect(metrics.cornerDeviation).toBeCloseTo(0, 5);
    expect(metrics.edgeSymmetry).toBeCloseTo(1, 5);
    expect(metrics.cornerAngles.every((angle) => Math.abs(angle - 90) < 1e-3)).toBe(true);
  });

  it("reports nonzero corner deviation for a skewed quad", () => {
    const skewed: Quad = [
      { x: 100, y: 50 },
      { x: 700, y: 90 },
      { x: 680, y: 580 },
      { x: 90, y: 540 },
    ];
    const metrics = computeEdgeMetrics(skewed);
    expect(metrics.cornerDeviation).toBeGreaterThan(0);
  });

  it("reports reduced edge symmetry when opposing edges have very different lengths", () => {
    const trapezoid: Quad = [
      { x: 300, y: 50 },
      { x: 500, y: 50 },
      { x: 700, y: 550 },
      { x: 100, y: 550 },
    ];
    const metrics = computeEdgeMetrics(trapezoid);
    expect(metrics.edgeSymmetry).toBeLessThan(0.9);
  });
});

describe("scorePerspective", () => {
  const thresholds = DEFAULT_QUALITY_CONFIG.perspective;

  it("scores a perfect rectangle at 100", () => {
    const metrics = computeEdgeMetrics(axisAlignedQuad(800, 600));
    const result = scorePerspective(metrics, thresholds);
    expect(result.perspectiveScore).toBe(100);
  });

  it("scores lower as corner deviation increases, all else equal", () => {
    const mild: Quad = [
      { x: 100, y: 60 },
      { x: 700, y: 50 },
      { x: 700, y: 550 },
      { x: 100, y: 540 },
    ];
    const severe: Quad = [
      { x: 100, y: 120 },
      { x: 700, y: 50 },
      { x: 700, y: 550 },
      { x: 100, y: 480 },
    ];
    const mildScore = scorePerspective(computeEdgeMetrics(mild), thresholds).perspectiveScore;
    const severeScore = scorePerspective(computeEdgeMetrics(severe), thresholds).perspectiveScore;
    expect(severeScore).toBeLessThan(mildScore);
  });
});
