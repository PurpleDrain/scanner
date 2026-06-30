import { describe, expect, it } from "vitest";
import type { Point, Quad } from "../../detection/types";
import { dstCornersForSize, homographyDstToSrc, warpOutputSize } from "../homography";

function mapPoint(h: Float32Array, p: Point): Point {
  const x = h[0]! * p.x + h[1]! * p.y + h[2]!;
  const y = h[3]! * p.x + h[4]! * p.y + h[5]!;
  const w = h[6]! * p.x + h[7]! * p.y + h[8]!;
  return { x: x / w, y: y / w };
}

describe("warpOutputSize", () => {
  it("matches edge lengths for an axis-aligned rectangle", () => {
    const quad: Quad = [
      { x: 100, y: 50 },
      { x: 500, y: 50 },
      { x: 500, y: 650 },
      { x: 100, y: 650 },
    ];
    const size = warpOutputSize(quad);
    expect(size.width).toBe(400);
    expect(size.height).toBe(600);
  });

  it("upscales to minOutputWidth", () => {
    const quad: Quad = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 200 },
      { x: 0, y: 200 },
    ];
    const size = warpOutputSize(quad, 2400);
    expect(size.width).toBe(2400);
    expect(size.height).toBe(4800);
  });
});

describe("homographyDstToSrc", () => {
  it("maps destination corners back to the source quad", () => {
    const src = [
      { x: 120, y: 80 },
      { x: 520, y: 90 },
      { x: 500, y: 700 },
      { x: 100, y: 680 },
    ];
    const dst = dstCornersForSize(401, 621);
    const h = homographyDstToSrc(dst, src);

    for (let i = 0; i < 4; i++) {
      const mapped = mapPoint(h, dst[i]!);
      expect(mapped.x).toBeCloseTo(src[i]!.x, 3);
      expect(mapped.y).toBeCloseTo(src[i]!.y, 3);
    }
  });
});
