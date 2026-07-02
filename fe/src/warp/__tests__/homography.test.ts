import { describe, expect, it } from "vitest";
import type { Point, Quad } from "../../detection/types";
import { dstCornersForSize, homographyDstToSrc, recoverAspectRatio, warpOutputSize } from "../homography";

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

  it("corrects the aspect ratio of a perspective-projected rectangle", () => {
    // True rectangle 320 wide × 220 tall, pitched and yawed (compound tilt) then projected.
    const f = 900;
    const imageWidth = 1200;
    const imageHeight = 1200;
    const cx = imageWidth / 2;
    const cy = imageHeight / 2;
    const theta = (25 * Math.PI) / 180; // pitch about x
    const phi = (20 * Math.PI) / 180; // yaw about y
    const dist = 1200;
    const halfW = 160;
    const halfH = 110;

    const project = (X: number, Y: number): Point => {
      // Rotate about x, then about y.
      const x1 = X;
      const y1 = Y * Math.cos(theta);
      const z1 = Y * Math.sin(theta);
      const xCam = x1 * Math.cos(phi) + z1 * Math.sin(phi);
      const yCam = y1;
      const zCam = -x1 * Math.sin(phi) + z1 * Math.cos(phi) + dist;
      return { x: (f * xCam) / zCam + cx, y: (f * yCam) / zCam + cy };
    };

    const quad: Quad = [
      project(-halfW, -halfH),
      project(halfW, -halfH),
      project(halfW, halfH),
      project(-halfW, halfH),
    ];

    const trueRatio = (halfW * 2) / (halfH * 2);
    const ratio = recoverAspectRatio(quad, imageWidth, imageHeight);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeCloseTo(trueRatio, 1);

    const size = warpOutputSize(quad, 0, { width: imageWidth, height: imageHeight });
    expect(size.width / size.height).toBeCloseTo(trueRatio, 1);
  });

  it("returns the plain edge ratio for a fronto-parallel rectangle", () => {
    const quad: Quad = [
      { x: 300, y: 250 },
      { x: 700, y: 250 },
      { x: 700, y: 550 },
      { x: 300, y: 550 },
    ];
    const ratio = recoverAspectRatio(quad, 1000, 800);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeCloseTo(400 / 300, 2);
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
