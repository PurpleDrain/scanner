import type { DetectionConfig } from "../config";
import { angularDistance, isConvex, lineIntersection, maxCornerAngleDeviation, polygonArea } from "../geometry";
import type { Candidate, FeatureMaps, Line, Quad } from "../types";

/**
 * Quadrilateral enumeration (candidate generation).
 *
 * Following the "find lines, then look for the four that form a document" strategy, candidate
 * lines are split into two near-perpendicular orientation groups (opposite document edges are
 * near-parallel, so they cluster together). We take 2 lines from each group, intersect them into
 * four corners, and keep only geometrically valid quads (convex, plausible area, near-rectangular,
 * corners roughly in frame). Scoring of the survivors happens in the scoring stage.
 */
export function enumerateQuads(maps: FeatureMaps, lines: Line[], config: DetectionConfig): Candidate[] {
  if (lines.length < 4) return [];

  const { width, height } = maps;
  const imageArea = width * height;

  const reference = lines[0].theta;
  const groupA: Line[] = [];
  const groupB: Line[] = [];
  for (const line of lines) {
    if (angularDistance(line.theta, reference) < Math.PI / 4) groupA.push(line);
    else groupB.push(line);
  }
  if (groupA.length < 2 || groupB.length < 2) return [];

  const a = groupA.slice(0, config.maxLinesPerGroup);
  const b = groupB.slice(0, config.maxLinesPerGroup);

  const marginX = width * config.cornerOutOfBoundsMargin;
  const marginY = height * config.cornerOutOfBoundsMargin;
  const minArea = imageArea * config.minQuadAreaFraction;
  const maxArea = imageArea * config.maxQuadAreaFraction;

  const candidates: Candidate[] = [];

  for (let i = 0; i < a.length; i++) {
    for (let j = i + 1; j < a.length; j++) {
      for (let k = 0; k < b.length; k++) {
        for (let l = k + 1; l < b.length; l++) {
          // Corners trace the quad: A_i∩B_k → A_i∩B_l → A_j∩B_l → A_j∩B_k.
          const c1 = lineIntersection(a[i], b[k]);
          const c2 = lineIntersection(a[i], b[l]);
          const c3 = lineIntersection(a[j], b[l]);
          const c4 = lineIntersection(a[j], b[k]);
          if (!c1 || !c2 || !c3 || !c4) continue;
          const corners: Quad = [c1, c2, c3, c4];

          if (!isConvex(corners)) continue;

          const area = polygonArea(corners);
          if (area < minArea || area > maxArea) continue;

          let outOfBounds = false;
          for (const c of corners) {
            if (c.x < -marginX || c.x > width + marginX || c.y < -marginY || c.y > height + marginY) {
              outOfBounds = true;
              break;
            }
          }
          if (outOfBounds) continue;

          if (maxCornerAngleDeviation(corners) > config.maxCornerAngleDeviationDeg) continue;

          candidates.push({ corners, lines: [a[i], a[j], b[k], b[l]] });
        }
      }
    }
  }

  return candidates;
}
