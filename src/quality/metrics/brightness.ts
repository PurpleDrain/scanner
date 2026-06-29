import type { CV, Mat as CvMat } from "@techstark/opencv-js";
import type { BrightnessMetric } from "../types";

const UNDEREXPOSED_PIXEL_VALUE = 10;
const OVEREXPOSED_PIXEL_VALUE = 245;

/**
 * Measures overall exposure of a grayscale image: mean intensity, plus the
 * fraction of pixels clipped near black/white (which `meanBrightness` alone
 * can hide — e.g. a small blown-out glare spot barely moves the mean).
 *
 * `gray` must be a single-channel image.
 */
export function computeBrightnessMetric(cv: CV, gray: CvMat): BrightnessMetric {
  const mean = new cv.Mat();
  const stddev = new cv.Mat();
  const underMask = new cv.Mat();
  const overMask = new cv.Mat();
  try {
    cv.meanStdDev(gray, mean, stddev);
    const totalPixels = gray.rows * gray.cols;

    cv.threshold(gray, underMask, UNDEREXPOSED_PIXEL_VALUE, 255, cv.THRESH_BINARY_INV);
    cv.threshold(gray, overMask, OVEREXPOSED_PIXEL_VALUE, 255, cv.THRESH_BINARY);

    return {
      meanBrightness: mean.data64F[0],
      underexposedFraction: cv.countNonZero(underMask) / totalPixels,
      overexposedFraction: cv.countNonZero(overMask) / totalPixels,
    };
  } finally {
    mean.delete();
    stddev.delete();
    underMask.delete();
    overMask.delete();
  }
}
