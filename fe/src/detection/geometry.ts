import type { Line, Point, Quad } from "./types";

/** Orders four arbitrary corner points as [top-left, top-right, bottom-right, bottom-left]. */
export function orderCorners(points: Point[]): Quad {
  const sorted = [...points];
  // Top-left has the smallest x+y sum; bottom-right the largest.
  // Top-right has the largest x−y difference; bottom-left the smallest.
  const bySum = [...sorted].sort((a, b) => a.x + a.y - (b.x + b.y));
  const byDiff = [...sorted].sort((a, b) => a.x - a.y - (b.x - b.y));
  const tl = bySum[0];
  const br = bySum[3];
  const tr = byDiff[3];
  const bl = byDiff[0];
  return [tl, tr, br, bl];
}

/** Intersection of two lines in Hesse normal form, or null if (near) parallel. */
export function lineIntersection(l1: Line, l2: Line): Point | null {
  const det = l1.cos * l2.sin - l2.cos * l1.sin;
  if (Math.abs(det) < 1e-6) return null;
  const x = (l1.rho * l2.sin - l2.rho * l1.sin) / det;
  const y = (l2.rho * l1.cos - l1.rho * l2.cos) / det;
  return { x, y };
}

export function polygonArea(corners: Quad): number {
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) / 2;
}

export function isConvex(corners: Quad): boolean {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const c = corners[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross !== 0) {
      const s = cross > 0 ? 1 : -1;
      if (sign === 0) sign = s;
      else if (s !== sign) return false;
    }
  }
  return true;
}

/** Mean of the two pairs of opposite side lengths → [meanWidth, meanHeight] of the quad. */
export function quadSideLengths(corners: Quad): { width: number; height: number } {
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const [tl, tr, br, bl] = corners;
  const top = dist(tl, tr);
  const bottom = dist(bl, br);
  const left = dist(tl, bl);
  const right = dist(tr, br);
  return { width: (top + bottom) / 2, height: (left + right) / 2 };
}

/** Scales each corner by `factor` (e.g. mapping feature-map coords back to source). */
export function scaleQuad(corners: Quad, factorX: number, factorY: number): Quad {
  return corners.map((p) => ({ x: p.x * factorX, y: p.y * factorY })) as Quad;
}
