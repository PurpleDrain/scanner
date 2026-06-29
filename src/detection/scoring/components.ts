import type { DetectionConfig } from "../config";
import { quadSideLengths } from "../geometry";
import type { Candidate, FeatureMaps, Point, Quad, ScoreComponents } from "../types";

/**
 * Per-candidate scoring components (spec section 4). Each returns 0..1:
 *  - edge: mean gradient magnitude along the four edges (a real border lies on strong gradients)
 *  - area: fraction of the frame covered (documents are large)
 *  - aspectRatio: plausibility of the long/short side ratio (paper-like, perspective-tolerant)
 *  - textDensity: mean interior text likelihood (documents contain text; backgrounds do not)
 *  - interiorConsistency: interior uniformity in Lab (pages are smooth between glyphs)
 */

/** Bilinear sample of a row-major field at fractional (x, y); 0 outside bounds. */
export function sampleField(field: Float32Array, width: number, height: number, x: number, y: number): number {
  if (x < 0 || y < 0 || x > width - 1 || y > height - 1) return 0;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const m00 = field[y0 * width + x0];
  const m10 = field[y0 * width + x1];
  const m01 = field[y1 * width + x0];
  const m11 = field[y1 * width + x1];
  const top = m00 + (m10 - m00) * fx;
  const bottom = m01 + (m11 - m01) * fx;
  return top + (bottom - top) * fy;
}

/** Point inside a convex quad via bilinear blend of its corners (s,t ∈ [0,1]). */
function quadPoint(corners: Quad, s: number, t: number): Point {
  const [c1, c2, c3, c4] = corners;
  const topX = c1.x + (c2.x - c1.x) * s;
  const topY = c1.y + (c2.y - c1.y) * s;
  const botX = c4.x + (c3.x - c4.x) * s;
  const botY = c4.y + (c3.y - c4.y) * s;
  return { x: topX + (botX - topX) * t, y: topY + (botY - topY) * t };
}

function edgeScore(maps: FeatureMaps, corners: Quad, config: DetectionConfig): number {
  if (maps.maxMagnitude === 0) return 0;
  let sum = 0;
  for (let e = 0; e < 4; e++) {
    const a = corners[e];
    const b = corners[(e + 1) % 4];
    let edgeSum = 0;
    for (let s = 0; s < config.edgeSamples; s++) {
      const t = (s + 0.5) / config.edgeSamples;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      edgeSum += sampleField(maps.magnitude, maps.width, maps.height, x, y);
    }
    sum += edgeSum / config.edgeSamples;
  }
  return Math.min(1, sum / 4 / maps.maxMagnitude);
}

function areaScore(corners: Quad, maps: FeatureMaps): number {
  // Shoelace area fraction; already constrained to <= maxQuadAreaFraction by enumeration.
  let area = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.min(1, Math.abs(area) / 2 / (maps.width * maps.height));
}

function aspectRatioScore(corners: Quad, config: DetectionConfig): number {
  const { width, height } = quadSideLengths(corners);
  if (width === 0 || height === 0) return 0;
  const ratio = Math.max(width, height) / Math.min(width, height);
  const [lo, hi] = config.aspectRatioRange;
  if (ratio >= lo && ratio <= hi) return 1;
  // Linear falloff outside the plausible band (tolerates perspective foreshortening).
  const dist = ratio < lo ? lo - ratio : ratio - hi;
  return Math.max(0, 1 - dist / 1.0);
}

function interiorSamples(maps: FeatureMaps, corners: Quad, grid = 7): { textDensity: number; consistency: number } {
  let textSum = 0;
  let count = 0;
  let lSum = 0;
  let lSqSum = 0;
  const haveLab = !!maps.labL;
  for (let i = 1; i < grid; i++) {
    for (let j = 1; j < grid; j++) {
      const p = quadPoint(corners, i / grid, j / grid);
      if (maps.textDensity) textSum += sampleField(maps.textDensity, maps.width, maps.height, p.x, p.y);
      if (haveLab) {
        const l = sampleField(maps.labL!, maps.width, maps.height, p.x, p.y);
        lSum += l;
        lSqSum += l * l;
      }
      count++;
    }
  }
  if (count === 0) return { textDensity: 0, consistency: 0 };
  const textDensity = maps.textDensity ? textSum / count : 0;

  let consistency = 0;
  if (haveLab) {
    const mean = lSum / count;
    const variance = Math.max(0, lSqSum / count - mean * mean);
    const std = Math.sqrt(variance);
    // 8-bit L; std ~25 (≈10 true L units) maps to zero consistency. Pages are smoother than that.
    consistency = Math.max(0, 1 - std / 25);
  }
  return { textDensity, consistency };
}

export function scoreComponents(maps: FeatureMaps, candidate: Candidate, config: DetectionConfig): ScoreComponents {
  const { corners } = candidate;
  const edge = edgeScore(maps, corners, config);
  const area = areaScore(corners, maps);
  const aspectRatio = aspectRatioScore(corners, config);
  const { textDensity: rawTextDensity, consistency } = interiorSamples(maps, corners);
  // Saturate: once a quad contains enough text it is clearly a document, so additional density
  // must not pull the selection toward a tight crop of the densest region over the full page.
  const textDensity = Math.min(1, rawTextDensity / config.textDensitySaturation);

  const w = config.weights;
  const total =
    w.edge * edge +
    w.textDensity * textDensity +
    w.area * area +
    w.aspectRatio * aspectRatio +
    w.interiorConsistency * consistency;

  return { edge, textDensity, area, aspectRatio, interiorConsistency: consistency, total };
}
