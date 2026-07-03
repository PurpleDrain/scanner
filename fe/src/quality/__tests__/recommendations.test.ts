import { describe, expect, it } from "vitest";
import {
  generateRecommendations,
  REC_BLURRY,
  REC_GLARE,
  REC_PERSPECTIVE,
  REC_RESOLUTION,
  REC_TOO_BRIGHT,
  REC_TOO_DARK,
  type QualityMetricResults,
} from "../recommendations";
import { DEFAULT_QUALITY_CONFIG } from "../config";

const guidance = DEFAULT_QUALITY_CONFIG.guidance;

function buildMetrics(overrides: Partial<QualityMetricResults> = {}): QualityMetricResults {
  return {
    blur: { blurVariance: 1000, blurScore: 100, blurSeverity: "excellent" },
    brightness: { meanBrightness: 175, underexposedFraction: 0, overexposedFraction: 0, brightnessScore: 100, brightnessStatus: "good" },
    glare: { glareCoveragePercent: 0, glareScore: 100, glareSeverity: "none" },
    perspective: {
      topLength: 100,
      bottomLength: 100,
      leftLength: 100,
      rightLength: 100,
      cornerAngles: [90, 90, 90, 90],
      cornerDeviation: 0,
      edgeSymmetry: 1,
      perspectiveScore: 100,
    },
    resolution: { width: 2400, height: 3200, resolutionScore: 100 },
    ...overrides,
  };
}

describe("generateRecommendations", () => {
  it("returns no recommendations when every metric is strong", () => {
    expect(generateRecommendations(buildMetrics(), guidance)).toEqual([]);
  });

  it("recommends holding steady when blur is weak", () => {
    const metrics = buildMetrics({
      blur: { blurVariance: 10, blurScore: 20, blurSeverity: "unusable" },
    });
    expect(generateRecommendations(metrics, guidance)).toContain(REC_BLURRY);
  });

  it("recommends more light when too dark", () => {
    const metrics = buildMetrics({
      brightness: { meanBrightness: 40, underexposedFraction: 0.5, overexposedFraction: 0, brightnessScore: 30, brightnessStatus: "too_dark" },
    });
    expect(generateRecommendations(metrics, guidance)).toContain(REC_TOO_DARK);
  });

  it("recommends moving from direct light when too bright", () => {
    const metrics = buildMetrics({
      brightness: { meanBrightness: 252, underexposedFraction: 0, overexposedFraction: 0.5, brightnessScore: 20, brightnessStatus: "too_bright" },
    });
    expect(generateRecommendations(metrics, guidance)).toContain(REC_TOO_BRIGHT);
  });

  it("recommends reducing glare for moderate and severe glare", () => {
    const moderate = buildMetrics({
      glare: { glareCoveragePercent: 16, glareScore: 40, glareSeverity: "moderate" },
    });
    const severe = buildMetrics({
      glare: { glareCoveragePercent: 40, glareScore: 5, glareSeverity: "severe" },
    });
    expect(generateRecommendations(moderate, guidance)).toContain(REC_GLARE);
    expect(generateRecommendations(severe, guidance)).toContain(REC_GLARE);
  });

  it("does not recommend reducing glare for minor glare", () => {
    const metrics = buildMetrics({
      glare: { glareCoveragePercent: 3, glareScore: 70, glareSeverity: "minor" },
    });
    expect(generateRecommendations(metrics, guidance)).not.toContain(REC_GLARE);
  });

  it("recommends holding the phone above the document when perspective is weak", () => {
    const metrics = buildMetrics({
      perspective: {
        topLength: 100,
        bottomLength: 140,
        leftLength: 100,
        rightLength: 100,
        cornerAngles: [70, 100, 90, 100],
        cornerDeviation: 15,
        edgeSymmetry: 0.7,
        perspectiveScore: 40,
      },
    });
    expect(generateRecommendations(metrics, guidance)).toContain(REC_PERSPECTIVE);
  });

  it("recommends moving the camera closer when resolution is weak", () => {
    const metrics = buildMetrics({
      resolution: { width: 600, height: 800, resolutionScore: 20 },
    });
    expect(generateRecommendations(metrics, guidance)).toContain(REC_RESOLUTION);
  });
});
