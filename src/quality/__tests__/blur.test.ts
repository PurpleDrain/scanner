import { describe, expect, it } from "vitest";
import { computeBlurMetric } from "../metrics/blur";
import { scoreBlur } from "../scoring/blur";
import { DEFAULT_QUALITY_CONFIG } from "../config";
import { toGray } from "../metrics/colorUtils";
import { drawTextLines, getTestCv, makeSolidCanvas } from "./testUtils";

describe("computeBlurMetric", () => {
  it("reports near-zero variance for a featureless flat image", async () => {
    const cv = await getTestCv();
    const mat = makeSolidCanvas(cv, 400, 300, 200);
    const gray = toGray(cv, mat);
    try {
      const { blurVariance } = computeBlurMetric(cv, gray);
      expect(blurVariance).toBeLessThan(1);
    } finally {
      mat.delete();
      gray.delete();
    }
  });

  it("reports higher variance for a sharp image than the same image blurred", async () => {
    const cv = await getTestCv();
    const sharp = makeSolidCanvas(cv, 400, 300, 245);
    drawTextLines(cv, sharp, 14);
    const blurred = new cv.Mat();
    const grayBlurred = new cv.Mat();
    const graySharp = toGray(cv, sharp);
    try {
      cv.GaussianBlur(sharp, blurred, new cv.Size(15, 15), 0);
      cv.cvtColor(blurred, grayBlurred, cv.COLOR_RGBA2GRAY);

      const sharpVariance = computeBlurMetric(cv, graySharp).blurVariance;
      const blurredVariance = computeBlurMetric(cv, grayBlurred).blurVariance;

      expect(sharpVariance).toBeGreaterThan(blurredVariance);
    } finally {
      sharp.delete();
      blurred.delete();
      grayBlurred.delete();
      graySharp.delete();
    }
  });
});

describe("scoreBlur", () => {
  const thresholds = DEFAULT_QUALITY_CONFIG.blur;

  it("classifies variance at/above the excellent threshold as excellent with score 100", () => {
    const result = scoreBlur({ blurVariance: thresholds.excellentVariance }, thresholds);
    expect(result.blurSeverity).toBe("excellent");
    expect(result.blurScore).toBe(100);
  });

  it("classifies variance below the poor threshold as unusable", () => {
    const result = scoreBlur({ blurVariance: thresholds.poorVariance / 2 }, thresholds);
    expect(result.blurSeverity).toBe("unusable");
    expect(result.blurScore).toBeLessThan(25);
  });

  it("classifies variance exactly at the acceptable threshold as acceptable", () => {
    const result = scoreBlur({ blurVariance: thresholds.acceptableVariance }, thresholds);
    expect(result.blurSeverity).toBe("acceptable");
    expect(result.blurScore).toBe(50);
  });

  it("is monotonically non-decreasing in variance", () => {
    const samples = [0, 50, 100, 150, 300, 500, 900, 2000];
    const scores = samples.map((blurVariance) => scoreBlur({ blurVariance }, thresholds).blurScore);
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeGreaterThanOrEqual(scores[i - 1]);
    }
  });
});
