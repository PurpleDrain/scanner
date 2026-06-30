import { describe, expect, it } from "vitest";
import { fuseDetection } from "../fuseDetection";
import type { MlDetectionResult } from "../ml/types";
import type { WorkerDetectionResult } from "../worker/types";

const baseCv = (overrides: Partial<WorkerDetectionResult> = {}): WorkerDetectionResult => ({
  quad: [
    { x: 10, y: 10 },
    { x: 100, y: 10 },
    { x: 100, y: 200 },
    { x: 10, y: 200 },
  ],
  confidence: { value: 0.3, edgeStrength: 0.3, quadValidity: 0.8, scoreGap: 0.5, textDensity: 0.2, geometricPlausibility: 0.7 },
  components: null,
  runnerUp: null,
  scale: 1,
  mode: "full",
  timings: { cv_ms: 12 },
  ...overrides,
});

const mlQuad = [
  { x: 12, y: 12 },
  { x: 98, y: 14 },
  { x: 96, y: 198 },
  { x: 11, y: 195 },
] as const;

const mlResult = (confidence: number): MlDetectionResult => ({
  quad: [...mlQuad],
  confidence,
  timings: { ml_inference_ms: 8 },
});

describe("fuseDetection", () => {
  it("keeps CV when ML is missing", () => {
    const cv = baseCv({ confidence: { ...baseCv().confidence!, value: 0.2 } });
    const fused = fuseDetection(cv, null);
    expect(fused.detector).toBe("cv");
    expect(fused.quad).toEqual(cv.quad);
  });

  it("uses ML when CV finds nothing", () => {
    const cv = baseCv({ quad: null, confidence: null });
    const fused = fuseDetection(cv, mlResult(0.6));
    expect(fused.detector).toBe("ml");
    expect(fused.quad).toEqual(mlQuad);
  });

  it("prefers ML even when CV is confident", () => {
    const cv = baseCv({ confidence: { ...baseCv().confidence!, value: 0.9 } });
    const fused = fuseDetection(cv, mlResult(0.4));
    expect(fused.detector).toBe("ml");
    expect(fused.quad).toEqual(mlQuad);
  });

  it("falls back to CV when ML is below confidence threshold", () => {
    const cv = baseCv({ confidence: { ...baseCv().confidence!, value: 0.3 } });
    const fused = fuseDetection(cv, mlResult(0.1));
    expect(fused.detector).toBe("cv");
    expect(fused.quad).toEqual(cv.quad);
  });

  it("falls back to CV when ML finds no quad", () => {
    const cv = baseCv();
    const fused = fuseDetection(cv, { quad: null, confidence: 0.9, timings: {} });
    expect(fused.detector).toBe("cv");
    expect(fused.quad).toEqual(cv.quad);
  });

  it("merges ML timings into the result", () => {
    const fused = fuseDetection(baseCv(), mlResult(0.55));
    expect(fused.timings.cv_ms).toBe(12);
    expect(fused.timings.ml_inference_ms).toBe(8);
  });

  it("attaches both source results for debug", () => {
    const cv = baseCv();
    const fused = fuseDetection(cv, mlResult(0.55));
    expect(fused.sources?.cv.quad).toEqual(cv.quad);
    expect(fused.sources?.cv.confidence).toBe(0.3);
    expect(fused.sources?.ml?.quad).toEqual(mlQuad);
    expect(fused.sources?.ml?.confidence).toBe(0.55);
  });
});
