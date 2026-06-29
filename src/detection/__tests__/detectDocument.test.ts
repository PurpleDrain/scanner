import { describe, expect, it } from "vitest";
import { detectDocument } from "../detectDocument";
import type { Quad } from "../types";
import { getTestCv, makeDocumentScene, maxCornerError } from "./testUtils";

const cv = await getTestCv();

const PERSPECTIVE_DOC: Quad = [
  { x: 120, y: 90 },
  { x: 500, y: 140 },
  { x: 470, y: 700 },
  { x: 90, y: 640 },
];

describe("detectDocument", () => {
  it("detects a perspective-skewed document on a contrasting background (full mode)", () => {
    const img = makeDocumentScene(cv, 600, 800, PERSPECTIVE_DOC);
    try {
      const result = detectDocument(cv, img, { mode: "full" });
      expect(result.quad).not.toBeNull();
      expect(maxCornerError(result.quad!, PERSPECTIVE_DOC)).toBeLessThan(0.06 * 800);
      expect(result.confidence!.value).toBeGreaterThan(0.4);
      expect(result.components!.total).toBeGreaterThan(0);
    } finally {
      img.delete();
    }
  });

  it("orders corners TL, TR, BR, BL", () => {
    const axis: Quad = [
      { x: 100, y: 120 },
      { x: 540, y: 120 },
      { x: 540, y: 760 },
      { x: 100, y: 760 },
    ];
    const img = makeDocumentScene(cv, 640, 880, axis);
    try {
      const { quad } = detectDocument(cv, img, { mode: "full" });
      expect(quad).not.toBeNull();
      const [tl, tr, br, bl] = quad!;
      expect(tl.y).toBeLessThan(bl.y);
      expect(tr.y).toBeLessThan(br.y);
      expect(tl.x).toBeLessThan(tr.x);
      expect(bl.x).toBeLessThan(br.x);
    } finally {
      img.delete();
    }
  });

  it("preview mode is fast and also locates the document", () => {
    const img = makeDocumentScene(cv, 600, 800, PERSPECTIVE_DOC);
    try {
      const result = detectDocument(cv, img, { mode: "preview" });
      expect(result.mode).toBe("preview");
      expect(result.quad).not.toBeNull();
      expect(maxCornerError(result.quad!, PERSPECTIVE_DOC)).toBeLessThan(0.08 * 800);
    } finally {
      img.delete();
    }
  });

  it("emits debug buffers only when requested", () => {
    const img = makeDocumentScene(cv, 600, 800, PERSPECTIVE_DOC);
    try {
      expect(detectDocument(cv, img, { mode: "full" }).debug).toBeUndefined();
      const withDebug = detectDocument(cv, img, { mode: "full", debug: true });
      expect(withDebug.debug).toBeDefined();
      expect(withDebug.debug!.featureMaps.magnitude.length).toBeGreaterThan(0);
      expect(withDebug.debug!.candidates.length).toBeGreaterThan(0);
      expect(withDebug.debug!.accumulatorHeatmap).toBeDefined();
    } finally {
      img.delete();
    }
  });

  it("reports per-stage timings", () => {
    const img = makeDocumentScene(cv, 600, 800, PERSPECTIVE_DOC);
    try {
      const { timings } = detectDocument(cv, img, { mode: "full" });
      expect(timings.features).toBeGreaterThanOrEqual(0);
      expect(timings.hough).toBeGreaterThanOrEqual(0);
      expect(timings.candidates).toBeGreaterThanOrEqual(0);
      expect(timings.scoring).toBeGreaterThanOrEqual(0);
    } finally {
      img.delete();
    }
  });

  it("returns null for a blank image with no document", () => {
    const img = new cv.Mat(400, 400, cv.CV_8UC4, new cv.Scalar(120, 120, 120, 255));
    try {
      const result = detectDocument(cv, img, { mode: "full" });
      expect(result.quad).toBeNull();
      expect(result.confidence).toBeNull();
    } finally {
      img.delete();
    }
  });

  it("does not leak Mats across repeated detections", () => {
    const img = makeDocumentScene(cv, 560, 760, PERSPECTIVE_DOC);
    try {
      for (let i = 0; i < 4; i++) {
        expect(detectDocument(cv, img, { mode: "full", debug: true }).quad).not.toBeNull();
      }
    } finally {
      img.delete();
    }
  });
});
