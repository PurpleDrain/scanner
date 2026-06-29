import { describe, expect, it } from "vitest";
import { computeTextDensity } from "../features/textDensity";
import { DEFAULT_DETECTION_CONFIG } from "../config";
import { getTestCv } from "./testUtils";

const cv = await getTestCv();

function meanOverRegion(
  field: Float32Array,
  width: number,
  height: number,
  x0: number,
  x1: number,
): number {
  let sum = 0;
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = x0; x < x1; x++) {
      sum += field[y * width + x];
      count++;
    }
  }
  return count ? sum / count : 0;
}

describe("computeTextDensity", () => {
  it("reports higher density in a glyph-filled region than a blank region", () => {
    const width = 200;
    const height = 120;
    const labL = new Float32Array(width * height).fill(230); // bright page

    // Scatter small dark blobs (glyph-sized connected components) across the LEFT half only.
    for (let y = 10; y < height - 10; y += 6) {
      for (let x = 10; x < width / 2 - 10; x += 8) {
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = 0; dx < 3; dx++) {
            labL[(y + dy) * width + (x + dx)] = 40;
          }
        }
      }
    }

    const density = computeTextDensity(cv, labL, width, height, DEFAULT_DETECTION_CONFIG);
    const left = meanOverRegion(density, width, height, 0, Math.floor(width / 2));
    const right = meanOverRegion(density, width, height, Math.floor(width / 2), width);

    expect(left).toBeGreaterThan(right);
    expect(left).toBeGreaterThan(0.2);
  });
});
