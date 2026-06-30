import type { CV } from "@techstark/opencv-js";
import type { DetectionConfig } from "../config";
import { isConvex, maxCornerAngleDeviation, orderCorners, polygonArea } from "../geometry";
import { scoreComponents } from "../scoring/components";
import type { Candidate, FeatureMaps, Line, Quad } from "../types";

const PLACEHOLDER_LINE: Line = { theta: 0, rho: 0, cos: 1, sin: 0, score: 0 };

/**
 * Builds a binary mask from the per-pixel max of normalised color-gradient and shadow response.
 * Both debug layers typically show a document-shaped blob even when interior Hough lines dominate.
 */
function buildEnvelopeMask(maps: FeatureMaps, config: DetectionConfig): Uint8Array {
  const { width, height, magnitude, maxMagnitude, shadow, shadowMax } = maps;
  const mask = new Uint8Array(width * height);
  const colorW = config.envelopeColorWeight;
  const shadowW = config.envelopeShadowWeight;
  const denom = colorW + shadowW || 1;

  for (let i = 0; i < mask.length; i++) {
    const colorNorm = maxMagnitude > 0 ? magnitude[i] / maxMagnitude : 0;
    const shadowNorm = shadow && shadowMax && shadowMax > 0 ? shadow[i] / shadowMax : 0;
    // Keep strong shadow OR color response so faint page borders survive even when one cue is weak.
    const fused = Math.max(shadowNorm, colorNorm * 0.8);
    const combined = Math.max(fused, (colorW * colorNorm + shadowW * shadowNorm) / denom);
    mask[i] = combined >= config.envelopeMaskThreshold ? 255 : 0;
  }
  return mask;
}

function approximateToQuad(
  cv: CV,
  contour: import("@techstark/opencv-js").Mat,
  perimeter: number,
): import("@techstark/opencv-js").Mat | null {
  const approx = new cv.Mat();
  try {
    let epsilon = 0.008 * perimeter;
    for (let i = 0; i < 10; i++) {
      cv.approxPolyDP(contour, approx, epsilon, true);
      if (approx.rows === 4 && cv.isContourConvex(approx)) {
        const out = new cv.Mat();
        approx.copyTo(out);
        return out;
      }
      epsilon *= 1.35;
    }
    return null;
  } finally {
    approx.delete();
  }
}

function quadFromMinAreaRect(cv: CV, contour: import("@techstark/opencv-js").Mat): Quad | null {
  const rect = cv.minAreaRect(contour);
  const points = cv.RotatedRect.points(rect);
  if (!points || points.length !== 4) return null;
  return orderCorners(points.map((p: { x: number; y: number }) => ({ x: p.x, y: p.y })));
}

function fitContourToQuad(cv: CV, contour: import("@techstark/opencv-js").Mat): Quad | null {
  const hull = new cv.Mat();
  try {
    cv.convexHull(contour, hull, false, true);
    const hullPerimeter = cv.arcLength(hull, true);

    const approx = approximateToQuad(cv, hull, hullPerimeter);
    if (approx) {
      try {
        return matToQuad(approx);
      } finally {
        approx.delete();
      }
    }

    return quadFromMinAreaRect(cv, hull);
  } finally {
    hull.delete();
  }
}

/**
 * Finds the largest convex quadrilateral that outlines the document blob in the combined
 * color/shadow envelope — an alternative to Hough line intersections when interior structure
 * produces stronger line votes than the physical page border.
 */
export function findEnvelopeCandidate(cv: CV, maps: FeatureMaps, config: DetectionConfig): Candidate | null {
  if (!maps.shadow) return null;

  const { width, height } = maps;
  const imageArea = width * height;
  const minArea = imageArea * config.minQuadAreaFraction;
  const maxArea = imageArea * config.maxQuadAreaFraction;

  const mask = buildEnvelopeMask(maps, config);
  const gray = new cv.Mat(height, width, cv.CV_8UC1);
  const closed = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  let k = Math.round(config.envelopeMorphKernelFraction * Math.min(width, height));
  if (k % 2 === 0) k += 1;
  if (k < 3) k = 3;
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(k, k));

  try {
    gray.data.set(mask);
    const erodeK = Math.max(3, Math.round(0.007 * Math.min(width, height)));
    const erodeKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(erodeK | 1, erodeK | 1));
    const eroded = new cv.Mat();
    cv.erode(gray, eroded, erodeKernel);
    cv.morphologyEx(eroded, closed, cv.MORPH_CLOSE, kernel);
    eroded.delete();
    erodeKernel.delete();
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let best: Quad | null = null;
    let bestFit = -1;

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);
      if (area < minArea || area > maxArea) {
        contour.delete();
        continue;
      }

      const corners = fitContourToQuad(cv, contour);
      if (corners) {
        const approxArea = polygonArea(corners);
        if (approxArea >= minArea && approxArea <= maxArea) {
          if (
            isConvex(corners) &&
            maxCornerAngleDeviation(corners) <= config.maxCornerAngleDeviationDeg
          ) {
            const candidate: Candidate = {
              corners,
              lines: [PLACEHOLDER_LINE, PLACEHOLDER_LINE, PLACEHOLDER_LINE, PLACEHOLDER_LINE],
            };
            const fit = scoreComponents(maps, candidate, config);
            const metric =
              fit.borderMargin * 0.45 + fit.edge * 0.3 + fit.envelopeSupport * 0.25 - Math.max(0, fit.area - config.maxFitArea) * 0.4;
            if (metric > bestFit) {
              best = corners;
              bestFit = metric;
            }
          }
        }
      }
      contour.delete();
    }

    if (!best) return null;

    return {
      corners: best,
      lines: [PLACEHOLDER_LINE, PLACEHOLDER_LINE, PLACEHOLDER_LINE, PLACEHOLDER_LINE],
    };
  } finally {
    gray.delete();
    closed.delete();
    contours.delete();
    hierarchy.delete();
    kernel.delete();
  }
}

/**
 * Finds page candidates from the broad paper surface rather than from edge/text responses.
 * This intentionally blurs away glyphs/stamps, thresholds the light page region, and fits large
 * external contours. It is expensive but very effective for uploads where text edges dominate.
 */
export function findSurfaceCandidates(cv: CV, maps: FeatureMaps, config: DetectionConfig): Candidate[] {
  if (!maps.labL) return [];

  const { width, height } = maps;
  const imageArea = width * height;
  const minArea = imageArea * config.preferredMinArea;
  const maxArea = imageArea * config.maxQuadAreaFraction;
  const l8 = new cv.Mat(height, width, cv.CV_8UC1);
  const blurred = new cv.Mat();
  const mask = new cv.Mat();
  const closed = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  const data = l8.data;
  for (let i = 0; i < data.length; i++) data[i] = Math.max(0, Math.min(255, Math.round(maps.labL[i])));

  let k = Math.round(0.025 * Math.min(width, height));
  if (k % 2 === 0) k += 1;
  if (k < 9) k = 9;
  const closeK = Math.max(9, Math.round(0.055 * Math.min(width, height)) | 1);
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(closeK, closeK));

  try {
    cv.GaussianBlur(l8, blurred, new cv.Size(k, k), 0);
    cv.threshold(blurred, mask, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
    cv.morphologyEx(mask, closed, cv.MORPH_CLOSE, kernel);
    cv.findContours(closed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const candidates: Candidate[] = [];
    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      try {
        const area = cv.contourArea(contour);
        if (area < minArea || area > maxArea) continue;

        const corners = fitContourToQuad(cv, contour);
        if (!corners) continue;

        const approxArea = polygonArea(corners);
        if (approxArea < minArea || approxArea > maxArea) continue;
        if (!isConvex(corners)) continue;
        if (maxCornerAngleDeviation(corners) > config.maxCornerAngleDeviationDeg) continue;

        candidates.push({
          corners,
          lines: [PLACEHOLDER_LINE, PLACEHOLDER_LINE, PLACEHOLDER_LINE, PLACEHOLDER_LINE],
        });
      } finally {
        contour.delete();
      }
    }

    return candidates;
  } finally {
    l8.delete();
    blurred.delete();
    mask.delete();
    closed.delete();
    contours.delete();
    hierarchy.delete();
    kernel.delete();
  }
}

function matToQuad(mat: import("@techstark/opencv-js").Mat): Quad {
  const data = mat.data32S;
  const points = [];
  for (let i = 0; i < mat.rows; i++) {
    points.push({ x: data[i * 2], y: data[i * 2 + 1] });
  }
  return orderCorners(points);
}

/** Skip adding the envelope candidate when a Hough quad already matches it closely. */
export function isDuplicateCandidate(existing: Quad, envelope: Quad, maps: FeatureMaps, config: DetectionConfig): boolean {
  const a = orderCorners(existing);
  const b = orderCorners(envelope);
  const threshold = Math.min(maps.width, maps.height) * config.envelopeDuplicateFraction;
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    sum += Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
  }
  return sum / 4 < threshold;
}
