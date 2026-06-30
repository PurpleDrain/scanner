import { describe, expect, it } from "vitest";
import type { Quad } from "../../documentScanner";
import { clampPoint, nearestCornerIndex } from "../cornerEditor";

const quad: Quad = [
  { x: 100, y: 100 },
  { x: 500, y: 120 },
  { x: 480, y: 400 },
  { x: 90, y: 380 },
];

describe("nearestCornerIndex", () => {
  it("returns the closest corner within range", () => {
    expect(nearestCornerIndex(quad, { x: 110, y: 105 }, 30)).toBe(0);
    expect(nearestCornerIndex(quad, { x: 495, y: 118 }, 30)).toBe(1);
    expect(nearestCornerIndex(quad, { x: 470, y: 405 }, 30)).toBe(2);
    expect(nearestCornerIndex(quad, { x: 95, y: 372 }, 30)).toBe(3);
  });

  it("returns -1 when no corner is within maxDist", () => {
    expect(nearestCornerIndex(quad, { x: 300, y: 250 }, 30)).toBe(-1);
  });

  it("prefers the nearer of two candidate corners", () => {
    // Equidistant-ish point biased toward corner 0.
    expect(nearestCornerIndex(quad, { x: 120, y: 110 }, 1000)).toBe(0);
  });
});

describe("clampPoint", () => {
  it("clamps to the source bounds", () => {
    expect(clampPoint({ x: -5, y: -10 }, 200, 150)).toEqual({ x: 0, y: 0 });
    expect(clampPoint({ x: 999, y: 999 }, 200, 150)).toEqual({ x: 200, y: 150 });
    expect(clampPoint({ x: 50, y: 60 }, 200, 150)).toEqual({ x: 50, y: 60 });
  });
});
