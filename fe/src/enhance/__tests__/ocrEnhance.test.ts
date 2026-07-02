import { describe, expect, it } from "vitest";
import { enhanceForOcr } from "../ocrEnhance";

function luma(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function variance(values: number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
}

describe("enhanceForOcr", () => {
  it("removes a strong illumination gradient from the background", () => {
    const width = 64;
    const height = 64;
    const data = new Uint8ClampedArray(width * height * 4);
    const textPixels: number[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        // Paper brightness ramps from ~120 (left) to ~250 (right): a strong shadow.
        const paper = 120 + (x / (width - 1)) * 130;
        const isText = x % 13 === 6 && y % 13 === 6;
        const v = isText ? Math.max(0, paper - 110) : paper;
        data[o] = v;
        data[o + 1] = v;
        data[o + 2] = v;
        data[o + 3] = 255;
        if (isText) textPixels.push(o);
      }
    }

    const before: number[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        if (x % 13 === 6 && y % 13 === 6) continue;
        before.push(luma(data[o]!, data[o + 1]!, data[o + 2]!));
      }
    }

    const out = enhanceForOcr(data, width, height, { sharpenAmount: 0 });

    const after: number[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const o = (y * width + x) * 4;
        if (x % 13 === 6 && y % 13 === 6) continue;
        after.push(luma(out[o]!, out[o + 1]!, out[o + 2]!));
      }
    }

    // Background variance (from the gradient) should drop dramatically.
    expect(variance(after)).toBeLessThan(variance(before) * 0.2);

    // Text remains clearly darker than the now-uniform paper.
    const paperMean = after.reduce((a, b) => a + b, 0) / after.length;
    for (const o of textPixels) {
      const textLuma = luma(out[o]!, out[o + 1]!, out[o + 2]!);
      expect(paperMean - textLuma).toBeGreaterThan(40);
    }
  });

  it("neutralizes a color cast so paper becomes near-neutral", () => {
    const width = 48;
    const height = 48;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      // Warm cast: red high, blue low.
      data[o] = 230;
      data[o + 1] = 200;
      data[o + 2] = 150;
      data[o + 3] = 255;
    }

    const out = enhanceForOcr(data, width, height, { sharpenAmount: 0 });

    // Sample a center pixel; channels should be close after white balancing.
    const o = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    const spread = Math.max(out[o]!, out[o + 1]!, out[o + 2]!) - Math.min(out[o]!, out[o + 1]!, out[o + 2]!);
    expect(spread).toBeLessThan(20);
  });

  it("preserves alpha and length", () => {
    const width = 16;
    const height = 16;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      data[o] = 180;
      data[o + 1] = 180;
      data[o + 2] = 180;
      data[o + 3] = i % 2 === 0 ? 255 : 128;
    }

    const out = enhanceForOcr(data, width, height);
    expect(out.length).toBe(data.length);
    for (let i = 0; i < width * height; i++) {
      expect(out[i * 4 + 3]).toBe(i % 2 === 0 ? 255 : 128);
    }
  });

  it("keeps a uniform image finite and near-white without NaNs", () => {
    const width = 20;
    const height = 20;
    const data = new Uint8ClampedArray(width * height * 4);
    for (let i = 0; i < width * height; i++) {
      const o = i * 4;
      data[o] = 200;
      data[o + 1] = 200;
      data[o + 2] = 200;
      data[o + 3] = 255;
    }

    const out = enhanceForOcr(data, width, height);
    const o = (Math.floor(height / 2) * width + Math.floor(width / 2)) * 4;
    for (let c = 0; c < 3; c++) {
      expect(Number.isFinite(out[o + c]!)).toBe(true);
      expect(out[o + c]!).toBeGreaterThan(200);
    }
  });
});
