import type { CV, Mat as CvMat } from "@techstark/opencv-js";

/** Converts an RGBA/RGB/BGR/already-gray Mat to single-channel grayscale. */
export function toGray(cv: CV, src: CvMat): CvMat {
  const gray = new cv.Mat();
  switch (src.channels()) {
    case 4:
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      break;
    case 3:
      cv.cvtColor(src, gray, cv.COLOR_RGB2GRAY);
      break;
    default:
      src.copyTo(gray);
  }
  return gray;
}

/** Converts an RGBA/RGB Mat to 3-channel RGB, as required by some color-space conversions. */
export function toRgb(cv: CV, src: CvMat): CvMat {
  const rgb = new cv.Mat();
  switch (src.channels()) {
    case 4:
      cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);
      break;
    case 3:
      src.copyTo(rgb);
      break;
    default:
      throw new Error(`Expected a color image with 3 or 4 channels, got ${src.channels()}`);
  }
  return rgb;
}
