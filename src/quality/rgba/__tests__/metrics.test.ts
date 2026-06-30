import { describe, expect, it } from "vitest";
import type { Quad } from "../../../documentScanner";
import { DEFAULT_QUALITY_CONFIG } from "../../config";
import { scoreBlur } from "../../scoring/blur";
import {
  computeBlurMetricRgba,
  computeBlurMetricRgbaSourceRegion,
  computeBrightnessMetricRgba,
  computeGlareMetricRgba,
} from "../metrics";

function solid(width: number, height: number, r: number, g: number, b: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const o = i * 4;
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
    data[o + 3] = 255;
  }
  return data;
}

/** Builds a per-pixel buffer from a callback returning [r,g,b]. */
function build(width: number, height: number, fn: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const [r, g, b] = fn(x, y);
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
  }
  return data;
}

describe("computeBlurMetricRgba", () => {
  it("reports ~0 variance for a uniform image", () => {
    const { blurVariance } = computeBlurMetricRgba(solid(16, 16, 128, 128, 128), 16, 16);
    expect(blurVariance).toBeCloseTo(0, 5);
  });

  it("reports high variance for a sharp checkerboard", () => {
    const sharp = build(16, 16, (x, y) => {
      const v = (x + y) % 2 === 0 ? 0 : 255;
      return [v, v, v];
    });
    const { blurVariance } = computeBlurMetricRgba(sharp, 16, 16);
    expect(blurVariance).toBeGreaterThan(1000);
  });

  it("ranks a sharp edge above a blurred one", () => {
    const sharp = build(16, 16, (x) => {
      const v = x < 8 ? 0 : 255;
      return [v, v, v];
    });
    const blurred = build(16, 16, (x) => {
      const v = Math.min(255, Math.max(0, (x - 4) * 32));
      return [v, v, v];
    });
    const sharpVar = computeBlurMetricRgba(sharp, 16, 16).blurVariance;
    const blurredVar = computeBlurMetricRgba(blurred, 16, 16).blurVariance;
    expect(sharpVar).toBeGreaterThan(blurredVar);
  });

  it("normalizes variance so checkerboard detail scores similarly at different widths", () => {
    const at64 = build(64, 64, (x, y) => {
      const v = (x + y) % 2 === 0 ? 0 : 255;
      return [v, v, v];
    });
    const at128 = build(128, 128, (x, y) => {
      const v = (x + y) % 2 === 0 ? 0 : 255;
      return [v, v, v];
    });
    const v64 = computeBlurMetricRgba(at64, 64, 64).blurVariance;
    const v128 = computeBlurMetricRgba(at128, 128, 128).blurVariance;
    expect(v64).toBeGreaterThan(0);
    expect(v128 / v64).toBeGreaterThan(0.2);
    expect(v128 / v64).toBeLessThan(4);
  });

  it("scores a sharp text-like source region as not blurry", () => {
    const w = 1200;
    const h = 1600;
    const data = build(w, h, (x) => {
      const v = Math.floor(x / 6) % 2 === 0 ? 235 : 25;
      return [v, v, v];
    });
    const quad: Quad = [
      { x: 0, y: 0 },
      { x: w, y: 0 },
      { x: w, y: h },
      { x: 0, y: h },
    ];
    const metric = computeBlurMetricRgbaSourceRegion(data, w, h, quad);
    const result = scoreBlur(metric, DEFAULT_QUALITY_CONFIG.blur);
    expect(result.blurScore).toBeGreaterThanOrEqual(DEFAULT_QUALITY_CONFIG.guidance.weakScoreThreshold);
  });
});

describe("computeBrightnessMetricRgba", () => {
  it("measures a black image as dark and underexposed", () => {
    const m = computeBrightnessMetricRgba(solid(8, 8, 0, 0, 0), 8, 8);
    expect(m.meanBrightness).toBeCloseTo(0, 5);
    expect(m.underexposedFraction).toBe(1);
    expect(m.overexposedFraction).toBe(0);
  });

  it("measures a white image as bright and overexposed", () => {
    const m = computeBrightnessMetricRgba(solid(8, 8, 255, 255, 255), 8, 8);
    expect(m.meanBrightness).toBeCloseTo(255, 0);
    expect(m.overexposedFraction).toBe(1);
    expect(m.underexposedFraction).toBe(0);
  });

  it("measures a mid-gray image near 128 with no clipping", () => {
    const m = computeBrightnessMetricRgba(solid(8, 8, 128, 128, 128), 8, 8);
    expect(m.meanBrightness).toBeCloseTo(128, 0);
    expect(m.underexposedFraction).toBe(0);
    expect(m.overexposedFraction).toBe(0);
  });
});

describe("computeGlareMetricRgba", () => {
  const thresholds = DEFAULT_QUALITY_CONFIG.glare;

  it("flags bright desaturated pixels as glare", () => {
    const { glareCoveragePercent } = computeGlareMetricRgba(solid(10, 10, 250, 250, 250), 10, 10, thresholds);
    expect(glareCoveragePercent).toBeCloseTo(100, 1);
  });

  it("does not flag bright but saturated (colored) pixels", () => {
    const { glareCoveragePercent } = computeGlareMetricRgba(solid(10, 10, 250, 40, 40), 10, 10, thresholds);
    expect(glareCoveragePercent).toBe(0);
  });

  it("reports partial coverage for a glare patch", () => {
    const data = build(10, 10, (x, y) => (x < 5 && y < 5 ? [250, 250, 250] : [120, 110, 100]));
    const { glareCoveragePercent } = computeGlareMetricRgba(data, 10, 10, thresholds);
    expect(glareCoveragePercent).toBeCloseTo(25, 1);
  });
});
