import type { Point, Quad } from "../detection/types";

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Recovers the true width/height aspect ratio of a rectangle from its perspective
 * projection (the detected quad), using a pinhole-camera model with the principal
 * point at the image centre and an unknown focal length (Zhang & He, 2007).
 *
 * Returns width/height, or null when the geometry is degenerate (caller should
 * fall back to the visible edge-length ratio).
 */
export function recoverAspectRatio(quad: Quad, imageWidth: number, imageHeight: number): number | null {
  if (imageWidth <= 0 || imageHeight <= 0) return null;

  const u0 = imageWidth / 2;
  const v0 = imageHeight / 2;

  // m1=top-left, m2=top-right, m3=bottom-left, m4=bottom-right, relative to the principal point.
  const [tl, tr, br, bl] = quad;
  const m1x = tl.x - u0;
  const m1y = tl.y - v0;
  const m2x = tr.x - u0;
  const m2y = tr.y - v0;
  const m3x = bl.x - u0;
  const m3y = bl.y - v0;
  const m4x = br.x - u0;
  const m4y = br.y - v0;

  const k2Den = (m2y - m4y) * m3x - (m2x - m4x) * m3y + m2x * m4y - m2y * m4x;
  const k3Den = (m3y - m4y) * m2x - (m3x - m4x) * m2y + m3x * m4y - m3y * m4x;
  if (Math.abs(k2Den) < 1e-9 || Math.abs(k3Den) < 1e-9) return null;

  const k2 = ((m1y - m4y) * m3x - (m1x - m4x) * m3y + m1x * m4y - m1y * m4x) / k2Den;
  const k3 = ((m1y - m4y) * m2x - (m1x - m4x) * m2y + m1x * m4y - m1y * m4x) / k3Den;

  // Near-affine (camera roughly parallel to the page): ratio is the Euclidean edge ratio.
  if (Math.abs(k2 - 1) < 1e-6 && Math.abs(k3 - 1) < 1e-6) {
    const topLen = Math.hypot(m2x - m1x, m2y - m1y);
    const leftLen = Math.hypot(m3x - m1x, m3y - m1y);
    if (leftLen < 1e-9) return null;
    return topLen / leftLen;
  }

  const fSquaredDen = (k3 - 1) * (k2 - 1);
  if (Math.abs(fSquaredDen) < 1e-9) return null;

  const fSquared =
    -((k3 * m3y - m1y) * (k2 * m2y - m1y) + (k3 * m3x - m1x) * (k2 * m2x - m1x)) / fSquaredDen;
  if (!Number.isFinite(fSquared) || fSquared <= 0) return null;

  const num =
    (k2 - 1) ** 2 +
    (k2 * m2y - m1y) ** 2 / fSquared +
    (k2 * m2x - m1x) ** 2 / fSquared;
  const den =
    (k3 - 1) ** 2 +
    (k3 * m3y - m1y) ** 2 / fSquared +
    (k3 * m3x - m1x) ** 2 / fSquared;
  if (den < 1e-12) return null;

  const ratio = Math.sqrt(num / den);
  if (!Number.isFinite(ratio) || ratio <= 0) return null;
  return ratio;
}

/**
 * Output dimensions for a perspective-flattened quad.
 *
 * When `imageSize` is supplied, the aspect ratio is recovered from the perspective
 * projection so angled captures are not squished; otherwise the visible edge
 * lengths are used directly.
 */
export function warpOutputSize(
  quad: Quad,
  minOutputWidth = 0,
  imageSize?: { width: number; height: number },
): { width: number; height: number } {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;
  let width = Math.max(1, Math.round(Math.max(distance(topLeft, topRight), distance(bottomLeft, bottomRight))));
  let height = Math.max(1, Math.round(Math.max(distance(topLeft, bottomLeft), distance(topRight, bottomRight))));

  if (imageSize) {
    const ratio = recoverAspectRatio(quad, imageSize.width, imageSize.height);
    if (ratio) {
      height = Math.max(1, Math.round(width / ratio));
    }
  }

  if (minOutputWidth > 0 && width < minOutputWidth) {
    const scale = minOutputWidth / width;
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  return { width, height };
}

/** 3×3 homography (row-major) mapping destination pixels → source pixels. */
export function homographyDstToSrc(
  dst: readonly Point[],
  src: readonly Point[],
): Float32Array {
  if (dst.length !== 4 || src.length !== 4) {
    throw new Error("homographyDstToSrc requires exactly four point pairs");
  }

  const a = new Float64Array(64);
  const b = new Float64Array(8);

  for (let i = 0; i < 4; i++) {
    const { x, y } = dst[i]!;
    const { x: xp, y: yp } = src[i]!;
    const r0 = i * 2;
    const r1 = r0 + 1;
    const c = r0 * 8;

    a[c] = x;
    a[c + 1] = y;
    a[c + 2] = 1;
    a[c + 6] = -xp * x;
    a[c + 7] = -xp * y;
    b[r0] = xp;

    a[c + 8 + 3] = x;
    a[c + 8 + 4] = y;
    a[c + 8 + 5] = 1;
    a[c + 8 + 6] = -yp * x;
    a[c + 8 + 7] = -yp * y;
    b[r1] = yp;
  }

  const h = solve8x8(a, b);
  return new Float32Array([h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1]);
}

function solve8x8(a: Float64Array, b: Float64Array): Float64Array {
  const n = 8;
  const m = new Float64Array(a);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(m[row * n + col]!) > Math.abs(m[pivot * n + col]!)) pivot = row;
    }

    if (Math.abs(m[pivot * n + col]!) < 1e-12) {
      throw new Error("Singular homography system");
    }

    if (pivot !== col) {
      for (let k = col; k < n; k++) {
        const tmp = m[col * n + k]!;
        m[col * n + k] = m[pivot * n + k]!;
        m[pivot * n + k] = tmp;
      }
      const tmpB = b[col]!;
      b[col] = b[pivot]!;
      b[pivot] = tmpB;
    }

    const div = m[col * n + col]!;
    for (let k = col; k < n; k++) m[col * n + k]! /= div;
    b[col]! /= div;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = m[row * n + col]!;
      if (factor === 0) continue;
      for (let k = col; k < n; k++) m[row * n + k]! -= factor * m[col * n + k]!;
      b[row]! -= factor * b[col]!;
    }
  }

  return b;
}

export function dstCornersForSize(width: number, height: number): Point[] {
  const w = width - 1;
  const h = height - 1;
  return [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
}
