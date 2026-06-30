import type { CV, Mat as CvMat } from "@techstark/opencv-js";

/** Builds an RGBA Mat from a pixel buffer (worker-safe — no canvas required). */
export function matFromRgba(cv: CV, data: Uint8ClampedArray, width: number, height: number): CvMat {
  const mat = new cv.Mat(height, width, cv.CV_8UC4);
  mat.data.set(data);
  return mat;
}
