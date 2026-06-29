import type { CV, Mat as CvMat } from "@techstark/opencv-js";
import { loadOpenCv } from "../../opencv";
import type { Point, Quad } from "../types";

export async function getTestCv(): Promise<CV> {
  return loadOpenCv();
}

/**
 * Renders a light "document" quadrilateral on a darker contrasting background, with faint
 * interior "text" lines — a photo of a page on a desk under perspective skew.
 */
export function makeDocumentScene(
  cv: CV,
  width: number,
  height: number,
  corners: Quad,
  options: { background?: number; page?: number; text?: boolean } = {},
): CvMat {
  const { background = 70, page = 232, text = true } = options;
  const img = new cv.Mat(height, width, cv.CV_8UC4, new cv.Scalar(background, background, background, 255));

  const flat = corners.flatMap((p) => [Math.round(p.x), Math.round(p.y)]);
  const poly = cv.matFromArray(4, 1, cv.CV_32SC2, flat);
  const polys = new cv.MatVector();
  polys.push_back(poly);
  cv.fillPoly(img, polys, new cv.Scalar(page, page, page, 255));
  poly.delete();
  polys.delete();

  if (text) {
    const [tl, tr, br, bl] = corners;
    const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    for (let i = 0; i < 14; i++) {
      const t = 0.1 + i * 0.06;
      const left = lerp(tl, bl, t);
      const right = lerp(tr, br, t);
      const a = lerp(left, right, 0.1);
      const b = lerp(left, right, 0.82);
      cv.line(img, new cv.Point(a.x, a.y), new cv.Point(b.x, b.y), new cv.Scalar(40, 40, 40, 255), 2);
    }
  }

  return img;
}

/**
 * Two vertical halves with IDENTICAL luminance but very different color: left is bluish, right
 * is yellowish, both with grayscale luma 0.299·R+0.587·G+0.114·B = 144.45. A grayscale Sobel sees
 * no edge at the boundary; a color-aware (Lab) gradient does.
 */
export function makeColorOnlyEdge(cv: CV, width: number, height: number): CvMat {
  const img = new cv.Mat(height, width, cv.CV_8UC4);
  const data = img.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const left = x < width / 2;
      data[i] = left ? 120 : 160; // R
      data[i + 1] = 150; // G
      data[i + 2] = left ? 180 : 75; // B
      data[i + 3] = 255;
    }
  }
  return img;
}

export function maxCornerError(detected: Quad, expected: Quad): number {
  let worst = 0;
  for (let i = 0; i < 4; i++) {
    const dist = Math.hypot(detected[i].x - expected[i].x, detected[i].y - expected[i].y);
    if (dist > worst) worst = dist;
  }
  return worst;
}
