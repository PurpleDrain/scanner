import { describe, expect, it } from "vitest";
import type { Quad } from "../../../documentScanner";
import { DEFAULT_QUALITY_CONFIG } from "../../config";
import { precaptureGuidance } from "../precaptureGuidance";

function makeQuad(width: number, height: number, offsetX = 100, offsetY = 80): Quad {
  return [
    { x: offsetX, y: offsetY },
    { x: offsetX + width, y: offsetY },
    { x: offsetX + width, y: offsetY + height },
    { x: offsetX, y: offsetY + height },
  ];
}

describe("precaptureGuidance", () => {
  it("suggests moving closer when the document is small in the frame", () => {
    const quad = makeQuad(500, 700);
    const result = precaptureGuidance(quad, DEFAULT_QUALITY_CONFIG, { width: 1920, height: 1080 });
    expect(result.hints).toContain("Bring the camera closer to capture more detail.");
  });

  it("suggests moving closer when the document covers too little of the viewfinder", () => {
    const quad = makeQuad(300, 400, 800, 600);
    const result = precaptureGuidance(quad, DEFAULT_QUALITY_CONFIG, { width: 4032, height: 3024 });
    expect(result.frameFill).not.toBeNull();
    expect(result.frameFill!).toBeLessThan(DEFAULT_QUALITY_CONFIG.guidance.minFrameFill);
    expect(result.hints).toContain("Bring the camera closer to capture more detail.");
  });

  it("does not suggest moving closer when the document fills enough of the frame", () => {
    const quad = makeQuad(2000, 2800);
    const result = precaptureGuidance(quad, DEFAULT_QUALITY_CONFIG);
    expect(result.resolutionScore).toBeGreaterThanOrEqual(DEFAULT_QUALITY_CONFIG.guidance.weakScoreThreshold);
    expect(result.hints).not.toContain("Bring the camera closer to capture more detail.");
  });
});
