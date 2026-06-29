import { describe, expect, it } from "vitest";
import { computeResolutionMetric } from "../metrics/resolution";
import { scoreResolution } from "../scoring/resolution";
import { DEFAULT_QUALITY_CONFIG } from "../config";
import { getTestCv } from "./testUtils";

describe("computeResolutionMetric", () => {
  it("reads width/height directly from the corrected Mat's dimensions", async () => {
    const cv = await getTestCv();
    const mat = new cv.Mat(1500, 1100, cv.CV_8UC4, new cv.Scalar(255, 255, 255, 255));
    try {
      expect(computeResolutionMetric(mat)).toEqual({ width: 1100, height: 1500 });
    } finally {
      mat.delete();
    }
  });
});

describe("scoreResolution", () => {
  const thresholds = DEFAULT_QUALITY_CONFIG.resolution;

  it("scores at/above the excellent width threshold at 100", () => {
    const result = scoreResolution({ width: thresholds.excellentWidthPx, height: 3000 }, thresholds);
    expect(result.resolutionScore).toBe(100);
  });

  it("scores below the poor width threshold under 25", () => {
    const result = scoreResolution({ width: thresholds.poorWidthPx - 100, height: 1000 }, thresholds);
    expect(result.resolutionScore).toBeLessThan(25);
  });

  it("is monotonically non-decreasing in width", () => {
    const widths = [0, 200, 800, 1200, 1800, 2400, 4000];
    const scores = widths.map((width) => scoreResolution({ width, height: 1000 }, thresholds).resolutionScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
  });
});
