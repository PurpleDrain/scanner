import type { CV, Mat as CvMat } from "@techstark/opencv-js";
import { loadOpenCv } from "../../opencv";
import type { Quad } from "../../documentScanner";

/** Shared, memoized OpenCV.js instance for tests (loadOpenCv() itself memoizes the load). */
export async function getTestCv(): Promise<CV> {
  return loadOpenCv();
}

/** A flat-colored RGBA canvas, e.g. a blank "page". */
export function makeSolidCanvas(cv: CV, width: number, height: number, gray: number): CvMat {
  return new cv.Mat(height, width, cv.CV_8UC4, new cv.Scalar(gray, gray, gray, 255));
}

/** Draws a grid of horizontal "text lines" onto a Mat, simulating printed text content. */
export function drawTextLines(cv: CV, mat: CvMat, lineCount = 12): void {
  const margin = Math.round(mat.cols * 0.1);
  const usableWidth = mat.cols - margin * 2;
  const spacing = mat.rows / (lineCount + 1);
  for (let i = 1; i <= lineCount; i++) {
    const y = Math.round(i * spacing);
    cv.line(
      mat,
      new cv.Point(margin, y),
      new cv.Point(margin + usableWidth, y),
      new cv.Scalar(40, 40, 40, 255),
      2,
    );
  }
}

/** A rectangular axis-aligned quad covering most of a `width`x`height` canvas. */
export function axisAlignedQuad(width: number, height: number, marginFraction = 0.05): Quad {
  const mx = Math.round(width * marginFraction);
  const my = Math.round(height * marginFraction);
  return [
    { x: mx, y: my },
    { x: width - mx, y: my },
    { x: width - mx, y: height - my },
    { x: mx, y: height - my },
  ];
}
