import type { Point, Quad } from "../../documentScanner";
import type { EdgeMetrics } from "../types";

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Interior angle in degrees at `vertex`, between rays to `prev` and `next`. */
function angleAtVertex(prev: Point, vertex: Point, next: Point): number {
  const v1 = { x: prev.x - vertex.x, y: prev.y - vertex.y };
  const v2 = { x: next.x - vertex.x, y: next.y - vertex.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const magnitude = Math.hypot(v1.x, v1.y) * Math.hypot(v2.x, v2.y);
  if (magnitude === 0) return 0;
  const cosTheta = Math.min(1, Math.max(-1, dot / magnitude));
  return (Math.acos(cosTheta) * 180) / Math.PI;
}

/**
 * Derives edge lengths and corner angles from a detected document quad.
 * A perfectly fronto-parallel, rectangular capture has all four corner
 * angles at 90 degrees and equal-length opposing edges; deviation from
 * either indicates the document was photographed at an angle (more
 * perspective correction was needed, which amplifies resampling artifacts
 * and non-uniform sharpness across the page).
 */
export function computeEdgeMetrics(quad: Quad): EdgeMetrics {
  const [topLeft, topRight, bottomRight, bottomLeft] = quad;

  const topLength = distance(topLeft, topRight);
  const bottomLength = distance(bottomLeft, bottomRight);
  const leftLength = distance(topLeft, bottomLeft);
  const rightLength = distance(topRight, bottomRight);

  const cornerAngles: [number, number, number, number] = [
    angleAtVertex(bottomLeft, topLeft, topRight),
    angleAtVertex(topLeft, topRight, bottomRight),
    angleAtVertex(topRight, bottomRight, bottomLeft),
    angleAtVertex(bottomRight, bottomLeft, topLeft),
  ];
  const cornerDeviation = cornerAngles.reduce((sum, angle) => sum + Math.abs(90 - angle), 0) / cornerAngles.length;

  const widthSymmetry = 1 - Math.abs(topLength - bottomLength) / Math.max(topLength, bottomLength);
  const heightSymmetry = 1 - Math.abs(leftLength - rightLength) / Math.max(leftLength, rightLength);
  const edgeSymmetry = (widthSymmetry + heightSymmetry) / 2;

  return { topLength, bottomLength, leftLength, rightLength, cornerAngles, cornerDeviation, edgeSymmetry };
}
