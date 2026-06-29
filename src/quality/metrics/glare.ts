import type { CV, Mat as CvMat } from "@techstark/opencv-js";
import type { GlareMetric } from "../types";
import type { GlareThresholds } from "../config";
import { toRgb } from "./colorUtils";

/**
 * Estimates the percentage of the document covered by specular glare
 * (smartphone flash or overhead light reflecting off the page).
 *
 * Glare pixels are both very bright *and* desaturated — a reflection washes
 * out the underlying page color toward white, unlike e.g. a plain white
 * background region, which is bright but not necessarily low-saturation in a
 * way that's distinguishable by brightness alone. Thresholding on
 * (high value) AND (low saturation) in HSV space catches that signature
 * cheaply, without any ML model.
 *
 * `color` must be a 3- or 4-channel (RGB/RGBA) image.
 */
export function computeGlareMetric(cv: CV, color: CvMat, thresholds: GlareThresholds): GlareMetric {
  const rgb = toRgb(cv, color);
  const hsv = new cv.Mat();
  const channels = new cv.MatVector();
  const valueMask = new cv.Mat();
  const saturationMask = new cv.Mat();
  const glareMask = new cv.Mat();
  try {
    cv.cvtColor(rgb, hsv, cv.COLOR_RGB2HSV);
    cv.split(hsv, channels);
    const saturation = channels.get(1);
    const value = channels.get(2);
    try {
      cv.threshold(value, valueMask, thresholds.brightnessThreshold, 255, cv.THRESH_BINARY);
      cv.threshold(saturation, saturationMask, thresholds.saturationThreshold, 255, cv.THRESH_BINARY_INV);
      cv.bitwise_and(valueMask, saturationMask, glareMask);

      const totalPixels = glareMask.rows * glareMask.cols;
      const glarePixels = cv.countNonZero(glareMask);
      return { glareCoveragePercent: (glarePixels / totalPixels) * 100 };
    } finally {
      saturation.delete();
      value.delete();
    }
  } finally {
    rgb.delete();
    hsv.delete();
    channels.delete();
    valueMask.delete();
    saturationMask.delete();
    glareMask.delete();
  }
}
