import type { Point, Quad } from "../detection/types";

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Output dimensions for a perspective-flattened quad (matches OpenCV warp sizing). */
export function warpOutputSize(quad: Quad, minOutputWidth = 0): { width: number; height: number } {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;
  let width = Math.round(Math.max(distance(topLeft, topRight), distance(bottomLeft, bottomRight)));
  let height = Math.round(Math.max(distance(topLeft, bottomLeft), distance(topRight, bottomRight)));
  width = Math.max(1, width);
  height = Math.max(1, height);

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
