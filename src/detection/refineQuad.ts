import type { DetectionConfig } from "./config";
import { isConvex, maxCornerAngleDeviation, orderCorners, polygonArea, quadSideLengths } from "./geometry";
import { scoreComponents } from "./scoring/components";
import type { Candidate, FeatureMaps, Line, Point, Quad } from "./types";

const PLACEHOLDER_LINE: Line = { theta: 0, rho: 0, cos: 1, sin: 0, score: 0 };

function quadCenter(corners: Quad): Point {
  return {
    x: (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4,
    y: (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4,
  };
}

function inwardNormal(corners: Quad, edgeIndex: number): Point {
  const a = corners[edgeIndex];
  const b = corners[(edgeIndex + 1) % 4];
  const tx = b.x - a.x;
  const ty = b.y - a.y;
  const len = Math.hypot(tx, ty) || 1;
  let nx = -ty / len;
  let ny = tx / len;
  const midX = (a.x + b.x) / 2;
  const midY = (a.y + b.y) / 2;
  const c = quadCenter(corners);
  if ((c.x - midX) * nx + (c.y - midY) * ny < 0) {
    nx = -nx;
    ny = -ny;
  }
  return { x: nx, y: ny };
}

function shiftEdge(corners: Quad, edgeIndex: number, normal: Point, delta: number): Quad {
  const i = edgeIndex;
  const j = (edgeIndex + 1) % 4;
  const out = corners.map((p) => ({ x: p.x, y: p.y })) as Quad;
  out[i] = { x: corners[i].x + normal.x * delta, y: corners[i].y + normal.y * delta };
  out[j] = { x: corners[j].x + normal.x * delta, y: corners[j].y + normal.y * delta };
  return out;
}

function moveCorner(corners: Quad, cornerIndex: number, dx: number, dy: number): Quad {
  const out = corners.map((p) => ({ x: p.x, y: p.y })) as Quad;
  out[cornerIndex] = { x: corners[cornerIndex].x + dx, y: corners[cornerIndex].y + dy };
  return out;
}

function isValidRefinedQuad(corners: Quad, maps: FeatureMaps, config: DetectionConfig): boolean {
  const frame = maps.width * maps.height;
  const area = polygonArea(corners);
  if (area < frame * config.minQuadAreaFraction || area > frame * config.maxQuadAreaFraction) return false;
  if (!isConvex(corners)) return false;
  if (maxCornerAngleDeviation(corners) > config.maxCornerAngleDeviationDeg) return false;
  return true;
}

function asCandidate(corners: Quad): Candidate {
  return {
    corners,
    lines: [PLACEHOLDER_LINE, PLACEHOLDER_LINE, PLACEHOLDER_LINE, PLACEHOLDER_LINE],
  };
}

/** Border-focused fit used during refinement — mirrors selectWinner's tight-border preference. */
function refinementFit(maps: FeatureMaps, corners: Quad, config: DetectionConfig): number {
  const c = scoreComponents(maps, asCandidate(corners), config);
  const areaPenalty = Math.max(0, c.area - config.maxFitArea) * 0.7;
  const { width, height } = quadSideLengths(corners);
  const short = Math.min(width, height);
  const ratio = short > 0 ? Math.max(width, height) / short : 0;
  const [lo, hi] = config.documentAspectRange;
  const shape =
    ratio >= lo && ratio <= hi
      ? 1
      : Math.max(0, 1 - (ratio < lo ? lo - ratio : ratio - hi) / 0.35);
  return (
    c.borderMargin * 0.34 +
    c.edge * 0.2 +
    c.envelopeSupport * 0.16 +
    shape * 0.2 +
    c.total * 0.1 -
    areaPenalty
  );
}

function refineEdges(maps: FeatureMaps, quad: Quad, config: DetectionConfig): Quad {
  let corners = orderCorners(quad);
  const search = config.edgeRefineSearch;
  const step = config.edgeRefineStep;

  for (let pass = 0; pass < config.edgeRefinePasses; pass++) {
    for (let e = 0; e < 4; e++) {
      const n = inwardNormal(corners, e);
      let bestDelta = 0;
      let bestScore = refinementFit(maps, corners, config);

      for (let d = -search; d <= search; d += step) {
        if (d === 0) continue;
        const shifted = shiftEdge(corners, e, n, d);
        if (!isValidRefinedQuad(shifted, maps, config)) continue;
        const score = refinementFit(maps, shifted, config);
        if (score > bestScore + 0.002) {
          bestScore = score;
          bestDelta = d;
        }
      }

      if (bestDelta !== 0) corners = shiftEdge(corners, e, n, bestDelta);
    }
  }

  return corners;
}

function refineCorners(maps: FeatureMaps, quad: Quad, config: DetectionConfig): Quad {
  const radius = config.edgeRefineCornerRadius;
  if (!radius) return quad;

  let corners = orderCorners(quad);
  const step = Math.max(1, config.edgeRefineStep);

  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < 4; i++) {
      let bestDx = 0;
      let bestDy = 0;
      let bestScore = refinementFit(maps, corners, config);

      for (let dy = -radius; dy <= radius; dy += step) {
        for (let dx = -radius; dx <= radius; dx += step) {
          if (dx === 0 && dy === 0) continue;
          const moved = moveCorner(corners, i, dx, dy);
          if (!isValidRefinedQuad(moved, maps, config)) continue;
          const score = refinementFit(maps, moved, config);
          if (score > bestScore + 0.002) {
            bestScore = score;
            bestDx = dx;
            bestDy = dy;
          }
        }
      }

      if (bestDx !== 0 || bestDy !== 0) corners = moveCorner(corners, i, bestDx, bestDy);
    }
  }

  return corners;
}

/**
 * Snaps quad edges and corners to the strongest document borders in the feature maps.
 * Uses full border-margin scoring at each step so overshoot onto the desk is penalised.
 */
export function refineQuadToEdges(maps: FeatureMaps, quad: Quad, config: DetectionConfig): Quad {
  if (!config.edgeRefineSearch) return orderCorners(quad);

  let corners = refineEdges(maps, quad, config);
  corners = refineCorners(maps, corners, config);
  corners = refineEdges(maps, corners, config);
  return orderCorners(corners);
}
