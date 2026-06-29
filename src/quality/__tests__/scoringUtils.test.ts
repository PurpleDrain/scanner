import { describe, expect, it } from "vitest";
import { clamp, piecewiseLinearScore } from "../scoring/utils";

describe("clamp", () => {
  it("clamps within range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(15, 0, 10)).toBe(10);
  });
});

describe("piecewiseLinearScore", () => {
  const anchors = [
    { value: 0, score: 0 },
    { value: 10, score: 50 },
    { value: 20, score: 100 },
  ];

  it("interpolates linearly between anchors", () => {
    expect(piecewiseLinearScore(5, anchors)).toBeCloseTo(25, 5);
    expect(piecewiseLinearScore(15, anchors)).toBeCloseTo(75, 5);
  });

  it("returns exact anchor scores at anchor values", () => {
    expect(piecewiseLinearScore(0, anchors)).toBe(0);
    expect(piecewiseLinearScore(10, anchors)).toBe(50);
    expect(piecewiseLinearScore(20, anchors)).toBe(100);
  });

  it("clamps to the endpoint score outside the anchor range", () => {
    expect(piecewiseLinearScore(-100, anchors)).toBe(0);
    expect(piecewiseLinearScore(1000, anchors)).toBe(100);
  });

  it("handles unsorted input anchors", () => {
    const shuffled = [anchors[2], anchors[0], anchors[1]];
    expect(piecewiseLinearScore(5, shuffled)).toBeCloseTo(25, 5);
  });

  it("handles a descending (higher value = lower score) anchor set", () => {
    const descending = [
      { value: 0, score: 100 },
      { value: 10, score: 0 },
    ];
    expect(piecewiseLinearScore(5, descending)).toBeCloseTo(50, 5);
    expect(piecewiseLinearScore(20, descending)).toBe(0);
  });
});
