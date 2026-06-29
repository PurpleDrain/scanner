import { describe, expect, it } from "vitest";
import { computeBrightnessMetric } from "../metrics/brightness";
import { scoreBrightness } from "../scoring/brightness";
import { DEFAULT_QUALITY_CONFIG } from "../config";
import { toGray } from "../metrics/colorUtils";
import { getTestCv, makeSolidCanvas } from "./testUtils";

describe("computeBrightnessMetric", () => {
  it("measures mean brightness of a solid-gray image accurately", async () => {
    const cv = await getTestCv();
    const mat = makeSolidCanvas(cv, 200, 200, 128);
    const gray = toGray(cv, mat);
    try {
      const { meanBrightness } = computeBrightnessMetric(cv, gray);
      expect(meanBrightness).toBeCloseTo(128, 0);
    } finally {
      mat.delete();
      gray.delete();
    }
  });

  it("reports a high overexposed fraction for a near-white image", async () => {
    const cv = await getTestCv();
    const mat = makeSolidCanvas(cv, 200, 200, 250);
    const gray = toGray(cv, mat);
    try {
      const { overexposedFraction, underexposedFraction } = computeBrightnessMetric(cv, gray);
      expect(overexposedFraction).toBeCloseTo(1, 5);
      expect(underexposedFraction).toBe(0);
    } finally {
      mat.delete();
      gray.delete();
    }
  });

  it("reports a high underexposed fraction for a near-black image", async () => {
    const cv = await getTestCv();
    const mat = makeSolidCanvas(cv, 200, 200, 5);
    const gray = toGray(cv, mat);
    try {
      const { underexposedFraction, overexposedFraction } = computeBrightnessMetric(cv, gray);
      expect(underexposedFraction).toBeCloseTo(1, 5);
      expect(overexposedFraction).toBe(0);
    } finally {
      mat.delete();
      gray.delete();
    }
  });
});

describe("scoreBrightness", () => {
  const thresholds = DEFAULT_QUALITY_CONFIG.brightness;

  it("scores the ideal mean at 100 with status good", () => {
    const result = scoreBrightness(
      { meanBrightness: thresholds.idealMean, underexposedFraction: 0, overexposedFraction: 0 },
      thresholds,
    );
    expect(result.brightnessScore).toBe(100);
    expect(result.brightnessStatus).toBe("good");
  });

  it("classifies below the underexposed threshold as too_dark", () => {
    const result = scoreBrightness(
      { meanBrightness: thresholds.underexposedMean - 5, underexposedFraction: 0.2, overexposedFraction: 0 },
      thresholds,
    );
    expect(result.brightnessStatus).toBe("too_dark");
    expect(result.brightnessScore).toBeLessThan(50);
  });

  it("classifies above the overexposed threshold as too_bright", () => {
    const result = scoreBrightness(
      { meanBrightness: thresholds.overexposedMean + 5, underexposedFraction: 0, overexposedFraction: 0.2 },
      thresholds,
    );
    expect(result.brightnessStatus).toBe("too_bright");
    expect(result.brightnessScore).toBeLessThan(50);
  });

  it("scores pure black and pure white at 0", () => {
    const black = scoreBrightness({ meanBrightness: 0, underexposedFraction: 1, overexposedFraction: 0 }, thresholds);
    const white = scoreBrightness({ meanBrightness: 255, underexposedFraction: 0, overexposedFraction: 1 }, thresholds);
    expect(black.brightnessScore).toBe(0);
    expect(white.brightnessScore).toBe(0);
  });
});
