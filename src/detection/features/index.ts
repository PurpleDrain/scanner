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
 * candidate generation and scoring. In "preview" mode only the (cheap) color gradient is built;
 * in "full" mode the text-density and shadow features are added and a gentle shadow contribution
 * is folded into the gradient magnitude so faint shadow edges can vote in the Hough stage.
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
  };

  if (!full) return maps;

  maps.labL = grad.labL;
  maps.labA = grad.labA;
  maps.labB = grad.labB;
  maps.textDensity = computeTextDensity(cv, grad.labL, width, height, config);

  const shadow = computeShadowEdges(cv, grad.labL, width, height, config);
  maps.shadow = shadow;

  // Fold a normalised, weighted shadow contribution into the gradient magnitude so soft shadow
  // borders strengthen real page edges in the accumulator without overwhelming the color signal.
  let shadowMax = 0;
  for (let i = 0; i < shadow.length; i++) if (shadow[i] > shadowMax) shadowMax = shadow[i];
  if (shadowMax > 0 && config.shadowWeight > 0) {
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
