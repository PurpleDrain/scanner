import { describe, expect, it } from "vitest";
import { computeColorGradient } from "../features/colorGradient";
import { DEFAULT_DETECTION_CONFIG } from "../config";
import { getTestCv, makeColorOnlyEdge } from "./testUtils";

const cv = await getTestCv();

/** Mean of a field within a vertical band [x0, x1). */
function bandMean(field: Float32Array, width: number, height: number, x0: number, x1: number): number {
  let sum = 0;
  let count = 0;
  for (let y = 2; y < height - 2; y++) {
    for (let x = x0; x < x1; x++) {
      sum += field[y * width + x];
      count++;
    }
  }
  return count ? sum / count : 0;
}

describe("computeColorGradient", () => {
  it("recovers an equal-luminance color edge that a luminance gradient misses", () => {
    const w = 120;
    const h = 80;
    const img = makeColorOnlyEdge(cv, w, h);
    try {
      const grad = computeColorGradient(cv, img, w, h, DEFAULT_DETECTION_CONFIG);
      const lo = Math.floor(w / 2) - 3;
      const hi = Math.floor(w / 2) + 3;

      const lEdge = bandMean(grad.magnitudeL, w, h, lo, hi);
      const bEdge = bandMean(grad.magnitudeB, w, h, lo, hi);
      const combined = bandMean(grad.magnitude, w, h, lo, hi);

      // The luminance gradient is near-blind to this boundary; the b (color) gradient is strong.
      expect(bEdge).toBeGreaterThan(lEdge * 3);
      // The combined color-aware magnitude registers a clear edge at the boundary.
      expect(combined).toBeGreaterThan(20);
    } finally {
      img.delete();
    }
  });

  it("returns Lab channels and per-channel magnitudes sized to the field", () => {
    const w = 64;
    const h = 48;
    const img = makeColorOnlyEdge(cv, w, h);
    try {
      const grad = computeColorGradient(cv, img, w, h, DEFAULT_DETECTION_CONFIG);
      for (const arr of [grad.magnitude, grad.magnitudeL, grad.magnitudeA, grad.magnitudeB, grad.labL, grad.labA, grad.labB]) {
        expect(arr.length).toBe(w * h);
      }
      expect(grad.maxMagnitude).toBeGreaterThan(0);
    } finally {
      img.delete();
    }
  });
});
