import { describe, expect, it } from "vitest";
import { previewDetectDimensions, PREVIEW_DETECT_MAX_DIM } from "../previewFrame";

describe("previewDetectDimensions", () => {
  it("keeps small images at native size", () => {
    const dims = previewDetectDimensions(400, 300);
    expect(dims.width).toBe(400);
    expect(dims.height).toBe(300);
    expect(dims.toSourceScale).toBe(1);
  });

  it("downscales so the longest side is at most PREVIEW_DETECT_MAX_DIM", () => {
    const dims = previewDetectDimensions(4000, 3000);
    expect(Math.max(dims.width, dims.height)).toBe(PREVIEW_DETECT_MAX_DIM);
    expect(dims.toSourceScale).toBeGreaterThan(1);
    expect(dims.width).toBe(480);
    expect(dims.height).toBe(360);
  });
});
