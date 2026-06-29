import type { CV, Mat as CvMat } from "@techstark/opencv-js";
import type { BlurMetric } from "../types";

/**
 * Computes the variance of the Laplacian of a grayscale image — a standard,
 * dependency-light proxy for sharpness. Sharp, high-frequency content (crisp
 * text edges) produces a high-variance Laplacian response; blurred images
 * suppress that high-frequency content, producing low variance.
 *
 * `gray` must be a single-channel image.
 */
export function computeBlurMetric(cv: CV, gray: CvMat): BlurMetric {
  const laplacian = new cv.Mat();
  const mean = new cv.Mat();
  const stddev = new cv.Mat();
  try {
    cv.Laplacian(gray, laplacian, cv.CV_64F);
    cv.meanStdDev(laplacian, mean, stddev);
    const sigma = stddev.data64F[0];
    return { blurVariance: sigma * sigma };
  } finally {
    laplacian.delete();
    mean.delete();
    stddev.delete();
  }
}
