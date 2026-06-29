import type { CV } from "@techstark/opencv-js";
import type { DetectionConfig } from "../config";

/**
 * Shadow-aware low-frequency edge feature (spec section 6).
 *
 * Even when a page has weak color/luminance contrast with its surface, it usually casts a soft
 * shadow along its border. A heavy Gaussian blur followed by Sobel responds to these broad,
 * low-frequency intensity ramps while ignoring sharp interior text. The result is combined with
 * the high-frequency color gradient so faint shadow boundaries can still contribute Hough votes.
 *
 * Returns a width*height low-frequency gradient-magnitude map.
 */
export function computeShadowEdges(
  cv: CV,
  labL: Float32Array,
  width: number,
  height: number,
  config: DetectionConfig,
): Float32Array {
  const gray = new cv.Mat(height, width, cv.CV_8UC1);
  const blurred = new cv.Mat();
  const gx = new cv.Mat();
  const gy = new cv.Mat();

  try {
    const u8 = new Uint8Array(width * height);
    for (let i = 0; i < u8.length; i++) u8[i] = Math.max(0, Math.min(255, labL[i]));
    gray.data.set(u8);

    // Large odd kernel sized relative to the frame, so it captures broad shadow ramps.
    let k = Math.round(config.shadowKernelFraction * Math.min(width, height));
    if (k % 2 === 0) k += 1;
    if (k < 3) k = 3;
    cv.GaussianBlur(gray, blurred, new cv.Size(k, k), 0);
    cv.Sobel(blurred, gx, cv.CV_32F, 1, 0, 3);
    cv.Sobel(blurred, gy, cv.CV_32F, 0, 1, 3);

    const gxData = gx.data32F;
    const gyData = gy.data32F;
    const out = new Float32Array(width * height);
    for (let i = 0; i < out.length; i++) out[i] = Math.hypot(gxData[i], gyData[i]);
    return out;
  } finally {
    gray.delete();
    blurred.delete();
    gx.delete();
    gy.delete();
  }
}
