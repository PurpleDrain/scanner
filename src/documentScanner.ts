import type { CV, Mat as CvMat } from "@techstark/opencv-js";
import { detectQuad } from "./detection/detectDocument";
import { orderCorners } from "./detection/geometry";
import type { Point, Quad } from "./detection/types";

export type { Point, Quad } from "./detection/types";
export { orderCorners } from "./detection/geometry";

const MIN_AREA_FRACTION = 0.1;

/**
 * Detects the document quadrilateral in the image, in source coordinates, or null.
 *
 * Delegates to the full color-aware, multi-scale detection pipeline (`src/detection`), falling
 * back to simple contour detection for high-contrast documents that already fill the frame (no
 * border to vote on). For live-preview detection with confidence/timings/debug, call
 * `detectDocument` from `src/detection/detectDocument` directly.
 */
export function findDocumentQuad(cv: CV, src: CvMat): Quad | null {
  return detectQuad(cv, src, { mode: "full" }) ?? findQuadByContour(cv, src);
}

/** Contour-based fallback: grayscale → blur → Canny → dilate → largest convex 4-point contour. */
function findQuadByContour(cv: CV, src: CvMat): Quad | null {
  const imageArea = src.rows * src.cols;
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const edged = new cv.Mat();
  const dilated = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);
    cv.Canny(blurred, edged, 50, 150);
    cv.dilate(edged, dilated, kernel);
    cv.findContours(dilated, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

    let best: Quad | null = null;
    let bestArea = imageArea * MIN_AREA_FRACTION;

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i);
      const area = cv.contourArea(contour);

      if (area > bestArea) {
        const approx = new cv.Mat();
        const perimeter = cv.arcLength(contour, true);
        cv.approxPolyDP(contour, approx, 0.02 * perimeter, true);

        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          best = orderCorners(matToPoints(approx));
          bestArea = area;
        }
        approx.delete();
      }
      contour.delete();
    }

    return best;
  } finally {
    gray.delete();
    blurred.delete();
    edged.delete();
    dilated.delete();
    contours.delete();
    hierarchy.delete();
    kernel.delete();
  }
}

function matToPoints(mat: CvMat): Point[] {
  const points: Point[] = [];
  const data = mat.data32S;
  for (let i = 0; i < mat.rows; i++) {
    points.push({ x: data[i * 2], y: data[i * 2 + 1] });
  }
  return points;
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export interface WarpOptions {
  /** Upscale the flattened output so its width is at least this many pixels (0 = native only). */
  minOutputWidth?: number;
  /** OpenCV interpolation flag (defaults to INTER_LINEAR). */
  interpolation?: number;
}

/**
 * Warps the quadrilateral region of `src` into an upright rectangular Mat,
 * sized to the quad's measured width/height (perspective correction).
 */
export function warpDocument(cv: CV, src: CvMat, quad: Quad, options: WarpOptions = {}): CvMat {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;

  let width = Math.round(Math.max(distance(topLeft, topRight), distance(bottomLeft, bottomRight)));
  let height = Math.round(Math.max(distance(topLeft, bottomLeft), distance(topRight, bottomRight)));

  const minOutputWidth = options.minOutputWidth ?? 0;
  if (minOutputWidth > 0 && width > 0 && width < minOutputWidth) {
    const scale = minOutputWidth / width;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const interpolation = options.interpolation ?? cv.INTER_LINEAR;

  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    topLeft.x, topLeft.y,
    topRight.x, topRight.y,
    bottomRight.x, bottomRight.y,
    bottomLeft.x, bottomLeft.y,
  ]);
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    width - 1, 0,
    width - 1, height - 1,
    0, height - 1,
  ]);

  const transform = cv.getPerspectiveTransform(srcTri, dstTri);
  const dst = new cv.Mat();

  try {
    cv.warpPerspective(src, dst, transform, new cv.Size(width, height), interpolation, cv.BORDER_CONSTANT, new cv.Scalar());
    return dst;
  } finally {
    srcTri.delete();
    dstTri.delete();
    transform.delete();
  }
}

/** Draws the quad outline and corner markers onto a 2D canvas context. */
export function drawQuadOutline(
  ctx: CanvasRenderingContext2D,
  quad: Quad,
  options: { stroke?: string; lineWidth?: number; cornerRadius?: number } = {},
): void {
  const { stroke = "#22c55e", lineWidth = 3, cornerRadius = 6 } = options;

  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.fillStyle = stroke;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(quad[0].x, quad[0].y);
  for (let i = 1; i < quad.length; i++) {
    ctx.lineTo(quad[i].x, quad[i].y);
  }
  ctx.closePath();
  ctx.stroke();

  for (const point of quad) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, cornerRadius, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
