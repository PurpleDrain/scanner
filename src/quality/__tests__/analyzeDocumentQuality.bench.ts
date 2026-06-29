import { bench, describe } from "vitest";
import { analyzeDocumentQuality } from "../analyzeDocumentQuality";
import { DEFAULT_QUALITY_CONFIG } from "../config";
import { computeBlurMetric } from "../metrics/blur";
import { computeGlareMetric } from "../metrics/glare";
import { toGray } from "../metrics/colorUtils";
import { axisAlignedQuad, drawTextLines, getTestCv, makeSolidCanvas } from "./testUtils";

const cv = await getTestCv();

describe("analyzeDocumentQuality (full pipeline)", () => {
  const image = makeSolidCanvas(cv, 2400, 3200, 220);
  drawTextLines(cv, image, 40);
  const quad = axisAlignedQuad(2400, 3200, 0.03);

  bench("a typical 2400x3200 phone-camera capture", () => {
    analyzeDocumentQuality(cv, image, { quad }, DEFAULT_QUALITY_CONFIG);
  });
});

describe("computeBlurMetric (Laplacian variance)", () => {
  const mat = makeSolidCanvas(cv, 2400, 3200, 220);
  drawTextLines(cv, mat, 40);
  const gray = toGray(cv, mat);

  bench("on a 2400x3200 grayscale page", () => {
    computeBlurMetric(cv, gray);
  });
});

describe("computeGlareMetric (HSV thresholding)", () => {
  const mat = makeSolidCanvas(cv, 2400, 3200, 220);

  bench("on a 2400x3200 color page", () => {
    computeGlareMetric(cv, mat, DEFAULT_QUALITY_CONFIG.glare);
  });
});
