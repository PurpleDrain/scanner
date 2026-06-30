import { describe, expect, it } from "vitest";
import { enhanceAutoContrast } from "../autoContrast";

/** Builds a horizontal gray ramp spanning [low, high]. */
function grayRamp(width: number, height: number, low: number, high: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const t = width === 1 ? 0 : x / (width - 1);
      const v = Math.round(low + t * (high - low));
      const o = (y * width + x) * 4;
      data[o] = v;
      data[o + 1] = v;
      data[o + 2] = v;
      data[o + 3] = 255;
    }
  }
  return data;
}

function lumaRange(data: Uint8ClampedArray): { min: number; max: number } {
  let min = 255;
  let max = 0;
  for (let i = 0; i < data.length; i += 4) {
    const y = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    min = Math.min(min, y);
    max = Math.max(max, y);
  }
  return { min, max };
}

describe("enhanceAutoContrast", () => {
  it("stretches a low-contrast ramp to a much wider range", () => {
    const w = 64;
    const h = 4;
    const input = grayRamp(w, h, 100, 150);
    const before = lumaRange(input);
    const out = enhanceAutoContrast(input, w, h);
    const after = lumaRange(out);

    expect(after.max - after.min).toBeGreaterThan(before.max - before.min);
    expect(after.min).toBeLessThan(20);
    expect(after.max).toBeGreaterThan(235);
  });

  it("preserves alpha and buffer length", () => {
    const out = enhanceAutoContrast(grayRamp(8, 8, 60, 200), 8, 8);
    expect(out.length).toBe(8 * 8 * 4);
    for (let i = 3; i < out.length; i += 4) {
      expect(out[i]).toBe(255);
    }
  });

  it("returns a copy unchanged when the image is uniform", () => {
    const w = 8;
    const h = 8;
    const input = grayRamp(w, h, 130, 130);
    const out = enhanceAutoContrast(input, w, h);
    expect(Array.from(out)).toEqual(Array.from(input));
    expect(out).not.toBe(input);
  });
});
