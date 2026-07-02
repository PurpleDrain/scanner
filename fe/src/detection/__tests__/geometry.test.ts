import { describe, expect, it } from "vitest";
import { isConvex, lineIntersection, orderCorners, polygonArea, quadSideLengths } from "../geometry";
import type { Line, Quad } from "../types";

describe("geometry", () => {
  it("orderCorners returns TL, TR, BR, BL regardless of input order", () => {
    const square: Quad = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const shuffled = [square[2], square[0], square[3], square[1]];
    const [tl, tr, br, bl] = orderCorners(shuffled);
    expect(tl).toEqual({ x: 0, y: 0 });
    expect(tr).toEqual({ x: 10, y: 0 });
    expect(br).toEqual({ x: 10, y: 10 });
    expect(bl).toEqual({ x: 0, y: 10 });
  });

  it("lineIntersection finds where two lines cross and rejects parallels", () => {
    const makeLine = (theta: number, rho: number): Line => ({
      theta,
      rho,
      cos: Math.cos(theta),
      sin: Math.sin(theta),
      score: 0,
    });
    // Vertical line x=5 (theta 0) and horizontal line y=8 (theta π/2).
    const p = lineIntersection(makeLine(0, 5), makeLine(Math.PI / 2, 8));
    expect(p).not.toBeNull();
    expect(p!.x).toBeCloseTo(5, 4);
    expect(p!.y).toBeCloseTo(8, 4);

    expect(lineIntersection(makeLine(0, 5), makeLine(0, 9))).toBeNull();
  });

  it("isConvex distinguishes a convex quad from a self-intersecting one", () => {
    const convex: Quad = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const bowtie: Quad = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    expect(isConvex(convex)).toBe(true);
    expect(isConvex(bowtie)).toBe(false);
  });

  it("polygonArea and quadSideLengths measure a rectangle", () => {
    const rect: Quad = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
    ];
    expect(polygonArea(rect)).toBeCloseTo(200, 4);
    const sides = quadSideLengths(rect);
    expect(sides.width).toBeCloseTo(20, 4);
    expect(sides.height).toBeCloseTo(10, 4);
  });
});
