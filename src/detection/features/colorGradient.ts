import type { CV, Mat as CvMat } from "@techstark/opencv-js";
import type { DetectionConfig } from "../config";

/**
 * Color-aware gradient extraction (spec sections 1 & 2).
 *
 * Grayscale collapses chroma, so an edge with strong color contrast but weak luminance contrast
 * (e.g. cream paper on a cream desk) is invisible to a luminance-only Sobel. We instead convert
 * to CIELAB and run the Sobel operator on each of the L, a, b channels, then combine them into a
 * single chroma-weighted gradient magnitude. The a/b (chroma) gradients are weighted up because
 * (a) OpenCV's 8-bit Lab scales L by 2.55 relative to a/b, and (b) we want color edges to be able
 * to out-vote interior text in the Hough stage.
 *
 * Returns the combined magnitude + direction (for Hough voting), the per-channel magnitudes (for
 * debug visualisation), and the resized Lab channels (reused by shadow + interior-consistency).
 */
export interface ColorGradientResult {
  width: number;
  height: number;
  magnitude: Float32Array;
  direction: Float32Array;
  maxMagnitude: number;
  magnitudeL: Float32Array;
  magnitudeA: Float32Array;
  magnitudeB: Float32Array;
  labL: Float32Array;
  labA: Float32Array;
  labB: Float32Array;
}

export function computeColorGradient(
  cv: CV,
  src: CvMat,
  width: number,
  height: number,
  config: DetectionConfig,
): ColorGradientResult {
  const small = new cv.Mat();
  const rgb = new cv.Mat();
  const lab = new cv.Mat();
  const channels = new cv.MatVector();
  const blurred = new cv.Mat();
  const gx = new cv.Mat();
  const gy = new cv.Mat();
  const ksize = new cv.Size(config.gaussianKernel, config.gaussianKernel);

  try {
    cv.resize(src, small, new cv.Size(width, height), 0, 0, cv.INTER_AREA);
    cv.cvtColor(small, rgb, cv.COLOR_RGBA2RGB);
    cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
    cv.split(lab, channels);

    const count = width * height;
    const labArrays: Float32Array[] = [];
    const magArrays: Float32Array[] = [];
    const gxArrays: Float32Array[] = [];
    const gyArrays: Float32Array[] = [];

    for (let c = 0; c < 3; c++) {
      const chan = channels.get(c);
      labArrays.push(Float32Array.from(chan.data));

      cv.GaussianBlur(chan, blurred, ksize, 0);
      cv.Sobel(blurred, gx, cv.CV_32F, 1, 0, 3);
      cv.Sobel(blurred, gy, cv.CV_32F, 0, 1, 3);

      const gxData = Float32Array.from(gx.data32F);
      const gyData = Float32Array.from(gy.data32F);
      gxArrays.push(gxData);
      gyArrays.push(gyData);

      const mag = new Float32Array(count);
      for (let i = 0; i < count; i++) mag[i] = Math.hypot(gxData[i], gyData[i]);
      magArrays.push(mag);
    }

    const [magL, magA, magB] = magArrays;
    const w = config.chromaWeight;
    const magnitude = new Float32Array(count);
    const direction = new Float32Array(count);
    let maxMagnitude = 0;

    for (let i = 0; i < count; i++) {
      const mL = magL[i];
      const mA = magA[i] * w;
      const mB = magB[i] * w;
      const combined = Math.sqrt(mL * mL + mA * mA + mB * mB);
      magnitude[i] = combined;
      if (combined > maxMagnitude) maxMagnitude = combined;

      // Direction comes from whichever channel has the strongest (weighted) edge response here,
      // so the Hough normal angle tracks the dominant color/luminance boundary at each pixel.
      let dom = 0;
      let domMag = mL;
      if (mA > domMag) {
        dom = 1;
        domMag = mA;
      }
      if (mB > domMag) {
        dom = 2;
        domMag = mB;
      }
      direction[i] = Math.atan2(gyArrays[dom][i], gxArrays[dom][i]);
    }

    return {
      width,
      height,
      magnitude,
      direction,
      maxMagnitude,
      magnitudeL: magL,
      magnitudeA: magA,
      magnitudeB: magB,
      labL: labArrays[0],
      labA: labArrays[1],
      labB: labArrays[2],
    };
  } finally {
    small.delete();
    rgb.delete();
    lab.delete();
    channels.delete();
    blurred.delete();
    gx.delete();
    gy.delete();
  }
}
