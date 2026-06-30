import type { CV, Mat as CvMat } from "@techstark/opencv-js";
import type { DetectionConfig } from "../config";
import type { FeatureMaps } from "../types";
import { computeColorGradient } from "./colorGradient";
import { computeShadowEdges } from "./shadowEdges";
import { computeTextDensity } from "./textDensity";

export { computeColorGradient } from "./colorGradient";
export { computeShadowEdges } from "./shadowEdges";
export { computeTextDensity } from "./textDensity";

/**
 * Feature-extraction stage: turns a source RGBA image into the {@link FeatureMaps} consumed by
 * candidate generation and scoring. Shadow + text-density are always built (needed for envelope
 * detection in live preview). Multi-scale search and optional shadow→Hough blending are full-only.
 */
export function extractFeatures(
  cv: CV,
  src: CvMat,
  width: number,
  height: number,
  config: DetectionConfig,
  full: boolean,
): FeatureMaps {
  const grad = computeColorGradient(cv, src, width, height, config);

  const maps: FeatureMaps = {
    width,
    height,
    scale: width / src.cols,
    magnitude: grad.magnitude,
    direction: grad.direction,
    maxMagnitude: grad.maxMagnitude,
    magnitudeL: grad.magnitudeL,
    magnitudeA: grad.magnitudeA,
    magnitudeB: grad.magnitudeB,
    labL: grad.labL,
    labA: grad.labA,
    labB: grad.labB,
  };

  maps.textDensity = computeTextDensity(cv, grad.labL, width, height, config);

  const shadow = computeShadowEdges(cv, grad.labL, width, height, config);
  maps.shadow = shadow;
  let shadowMax = 0;
  for (let i = 0; i < shadow.length; i++) if (shadow[i] > shadowMax) shadowMax = shadow[i];
  maps.shadowMax = shadowMax;

  if (full && shadowMax > 0 && config.shadowWeight > 0) {
    const scale = (config.shadowWeight * grad.maxMagnitude) / shadowMax;
    let newMax = 0;
    for (let i = 0; i < maps.magnitude.length; i++) {
      maps.magnitude[i] += shadow[i] * scale;
      if (maps.magnitude[i] > newMax) newMax = maps.magnitude[i];
    }
    maps.maxMagnitude = newMax;
  }

  return maps;
}
