import { describe, expect, it } from "vitest";
import { postprocessHeatmaps } from "../ml/docAlignerModel";
import { centroidAboveThreshold, resizeFloatBilinear } from "../ml/heatmap";

describe("heatmap utils", () => {
  it("upscales a single peak to the expected location", () => {
    const src = new Float32Array(4);
    src[0] = 1;
    const up = resizeFloatBilinear(src, 2, 2, 4, 4);
    const pt = centroidAboveThreshold(up, 4, 4, 0.3);
    expect(pt).not.toBeNull();
    expect(pt!.x).toBeGreaterThan(0);
    expect(pt!.y).toBeGreaterThan(0);
  });

  it("returns null when no pixels exceed threshold", () => {
    const map = new Float32Array(16).fill(0.1);
    expect(centroidAboveThreshold(map, 4, 4, 0.3)).toBeNull();
  });
});

describe("postprocessHeatmaps", () => {
  it("extracts four corners from synthetic heatmaps", () => {
    const heatW = 8;
    const heatH = 8;
    const heatmaps = new Float32Array(4 * heatW * heatH);
    const peaks = [
      [1, 1],
      [6, 1],
      [6, 6],
      [1, 6],
    ] as const;

    for (let c = 0; c < 4; c++) {
      const [px, py] = peaks[c];
      heatmaps[c * heatW * heatH + py * heatW + px] = 0.9;
    }

    const { quad, confidence } = postprocessHeatmaps(heatmaps, heatW, heatH, 800, 600);
    expect(quad).not.toBeNull();
    expect(confidence).toBeGreaterThan(0.2);
    expect(quad![0].x).toBeLessThan(quad![1].x);
    expect(quad![0].y).toBeLessThan(quad![3].y);
  });
});
