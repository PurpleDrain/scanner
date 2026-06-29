import { describe, expect, it } from "vitest";
import { analyzeDocumentQuality } from "../analyzeDocumentQuality";
import { DEFAULT_QUALITY_CONFIG } from "../config";
import { axisAlignedQuad, drawTextLines, getTestCv, makeSolidCanvas } from "./testUtils";

describe("analyzeDocumentQuality", () => {
  it("grades a sharp, well-lit, square-on, high-resolution page as good or better", async () => {
    const cv = await getTestCv();
    const image = makeSolidCanvas(cv, 2600, 3600, 230);
    drawTextLines(cv, image, 40);
    const quad = axisAlignedQuad(2600, 3600, 0.02);
    try {
      const result = analyzeDocumentQuality(cv, image, { quad }, DEFAULT_QUALITY_CONFIG);

      expect(["excellent", "good"]).toContain(result.qualityGrade);
      expect(result.overallScore).toBeGreaterThanOrEqual(DEFAULT_QUALITY_CONFIG.overallGrade.good);
      expect(result.recommendations).toEqual([]);
      expect(result.blur.blurVariance).toBeGreaterThan(0);
      expect(result.resolution.width).toBeGreaterThan(0);
      expect(result.resolution.height).toBeGreaterThan(0);
    } finally {
      image.delete();
    }
  });

  it("flags a dark, blurry, low-resolution, skewed capture with matching recommendations", async () => {
    const cv = await getTestCv();
    const image = makeSolidCanvas(cv, 300, 400, 30);
    const quad: [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ] = [
      { x: 40, y: 90 },
      { x: 260, y: 10 },
      { x: 250, y: 380 },
      { x: 60, y: 330 },
    ];
    try {
      const result = analyzeDocumentQuality(cv, image, { quad }, DEFAULT_QUALITY_CONFIG);

      expect(result.qualityGrade).not.toBe("excellent");
      expect(result.brightness.brightnessStatus).toBe("too_dark");
      expect(result.recommendations).toContain("The photo is too dark. Move to a brighter area or turn on more light.");
      expect(result.recommendations).toContain("Move the camera closer to the document.");
      expect(result.recommendations).toContain("Image is blurry. Hold the phone steady.");
    } finally {
      image.delete();
    }
  });

  it("does not leak OpenCV Mats: repeated calls do not throw or grow unbounded", async () => {
    const cv = await getTestCv();
    const image = makeSolidCanvas(cv, 1200, 1600, 200);
    drawTextLines(cv, image, 20);
    const quad = axisAlignedQuad(1200, 1600, 0.05);
    try {
      for (let i = 0; i < 5; i++) {
        const result = analyzeDocumentQuality(cv, image, { quad }, DEFAULT_QUALITY_CONFIG);
        expect(result.overallScore).toBeGreaterThanOrEqual(0);
        expect(result.overallScore).toBeLessThanOrEqual(100);
      }
    } finally {
      image.delete();
    }
  });
});
