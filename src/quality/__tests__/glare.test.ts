import { describe, expect, it } from "vitest";
import { computeGlareMetric } from "../metrics/glare";
import { scoreGlare } from "../scoring/glare";
import { DEFAULT_QUALITY_CONFIG } from "../config";
import { getTestCv } from "./testUtils";

describe("computeGlareMetric", () => {
  it("reports ~0% coverage for a saturated, moderately bright page with no hotspot", async () => {
    const cv = await getTestCv();
    // Saturated blue-ish color: value=200 (below the 230 brightness threshold),
    // saturation=153 (above the 60 saturation threshold) - should not be flagged as glare.
    const mat = new cv.Mat(300, 400, cv.CV_8UC4, new cv.Scalar(80, 150, 200, 255));
    try {
      const { glareCoveragePercent } = computeGlareMetric(cv, mat, DEFAULT_QUALITY_CONFIG.glare);
      expect(glareCoveragePercent).toBeCloseTo(0, 1);
    } finally {
      mat.delete();
    }
  });

  it("reports coverage matching a known bright, desaturated hotspot's area fraction", async () => {
    const cv = await getTestCv();
    const width = 400;
    const height = 300;
    const mat = new cv.Mat(height, width, cv.CV_8UC4, new cv.Scalar(80, 150, 200, 255));
    try {
      // A 100x60 fully white (bright + desaturated) patch = 6000 / 120000 = 5% of the page.
      cv.rectangle(mat, new cv.Point(100, 100), new cv.Point(200, 160), new cv.Scalar(255, 255, 255, 255), -1);
      const { glareCoveragePercent } = computeGlareMetric(cv, mat, DEFAULT_QUALITY_CONFIG.glare);
      expect(glareCoveragePercent).toBeCloseTo(5, 0);
    } finally {
      mat.delete();
    }
  });
});

describe("scoreGlare", () => {
  const thresholds = DEFAULT_QUALITY_CONFIG.glare;

  it("scores 0% coverage as none with score 100", () => {
    const result = scoreGlare({ glareCoveragePercent: 0 }, thresholds);
    expect(result.glareSeverity).toBe("none");
    expect(result.glareScore).toBe(100);
  });

  it("classifies coverage above the moderate threshold as severe", () => {
    const result = scoreGlare({ glareCoveragePercent: thresholds.moderateCoveragePercent + 1 }, thresholds);
    expect(result.glareSeverity).toBe("severe");
  });

  it("is monotonically non-increasing in coverage", () => {
    const samples = [0, 1, 3, 5, 10, 15, 30, 60];
    const scores = samples.map((glareCoveragePercent) => scoreGlare({ glareCoveragePercent }, thresholds).glareScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });
});
