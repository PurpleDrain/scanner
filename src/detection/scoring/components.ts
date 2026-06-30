import type { DetectionConfig } from "../config";
import { orderCorners, perspectiveParallelismScore, quadSideLengths } from "../geometry";
import type { Candidate, FeatureMaps, Point, Quad, ScoreComponents } from "../types";

/**
 * Per-candidate scoring components (spec section 4). Each returns 0..1:
 *  - edge: mean gradient magnitude along the four edges (a real border lies on strong gradients)
 *  - area: fraction of the frame covered (documents are large)
 *  - aspectRatio: plausibility of the long/short side ratio (paper-like, perspective-tolerant)
 *  - textDensity: mean interior text likelihood (documents contain text; backgrounds do not)
 *  - interiorConsistency: interior uniformity in Lab (pages are smooth between glyphs)
 *  - borderMargin: borders look like page edges, not interior text lines or desk overshoot
 *  - envelopeSupport: shadow + color response along the border (matches the debug envelope blob)
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
  let ratioScore = 1;
  if (ratio < lo || ratio > hi) {
    const dist = ratio < lo ? lo - ratio : ratio - hi;
    ratioScore = Math.max(0, 1 - dist / 1.6);
  }
  const parallel = perspectiveParallelismScore(corners);
  return ratioScore * 0.4 + parallel * 0.6;
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

function quadCenter(corners: Quad): Point {
  return {
    x: (corners[0].x + corners[1].x + corners[2].x + corners[3].x) / 4,
    y: (corners[0].y + corners[1].y + corners[2].y + corners[3].y) / 4,
  };
}

/** Unit normal pointing into the quad from the midpoint of edge `edgeIndex`. */
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

type StripField = "magnitude" | "textDensity";

function sampleEdgeStrip(
  maps: FeatureMaps,
  corners: Quad,
  edgeIndex: number,
  normal: Point,
  normalOffset: number,
  samples: number,
  field: StripField,
): number {
  const a = corners[edgeIndex];
  const b = corners[(edgeIndex + 1) % 4];
  let sum = 0;
  for (let s = 0; s < samples; s++) {
    const t = (s + 0.5) / samples;
    const x = a.x + (b.x - a.x) * t + normal.x * normalOffset;
    const y = a.y + (b.y - a.y) * t + normal.y * normalOffset;
    if (field === "magnitude") {
      sum += sampleField(maps.magnitude, maps.width, maps.height, x, y);
    } else if (maps.textDensity) {
      sum += sampleField(maps.textDensity, maps.width, maps.height, x, y);
    }
  }
  return sum / samples;
}

/**
 * Scores whether each edge is a physical page border rather than an interior text line or a
 * quad that overshoots the paper onto the desk. Corners must be canonical [TL, TR, BR, BL].
 */
function borderMarginScore(maps: FeatureMaps, corners: Quad, config: DetectionConfig): number {
  if (maps.maxMagnitude === 0) return 0;

  const strip = config.borderStripWidth;
  const samples = Math.max(8, Math.floor(config.edgeSamples / 2));
  const edgeScores: number[] = [];

  for (let e = 0; e < 4; e++) {
    const n = inwardNormal(corners, e);
    const edgeMean = sampleEdgeStrip(maps, corners, e, n, 0, samples, "magnitude");
    const innerMean = sampleEdgeStrip(maps, corners, e, n, strip, samples, "magnitude");

    // A real border has stronger response on the line than on a parallel interior offset.
    let s = edgeMean / (edgeMean + innerMean + 1e-3);

    // Top: immediately inside should be a clear margin, not the first line of body text.
    if (e === 0 && maps.textDensity) {
      const innerText = sampleEdgeStrip(maps, corners, e, n, strip, samples, "textDensity");
      if (innerText > config.topMarginTextThreshold) {
        s *= Math.max(0.15, 1 - innerText / config.topMarginTextThreshold);
      }
    }

    // Top: a stronger edge outside (toward the physical page top) means this edge is too low.
    if (e === 0) {
      let outwardPeak = 0;
      for (let d = strip; d <= config.maxBorderSearch; d += strip) {
        outwardPeak = Math.max(outwardPeak, sampleEdgeStrip(maps, corners, e, n, -d, samples, "magnitude"));
      }
      if (outwardPeak > edgeMean * config.outwardEdgeRatio) s *= 0.35;
    }

    // Side edges: penalise overshoot onto the desk (true border sits inward or outward).
    if (e === 1 || e === 3) {
      let outwardPeak = 0;
      let inwardPeak = innerMean;
      for (let d = strip; d <= config.maxBorderSearch; d += strip) {
        outwardPeak = Math.max(outwardPeak, sampleEdgeStrip(maps, corners, e, n, -d, samples, "magnitude"));
        inwardPeak = Math.max(inwardPeak, sampleEdgeStrip(maps, corners, e, n, d, samples, "magnitude"));
      }
      if (outwardPeak > edgeMean * config.outwardEdgeRatio) s *= 0.4;
      if (inwardPeak > edgeMean * config.outwardEdgeRatio) s *= 0.4;

      const outerText = maps.textDensity
        ? sampleEdgeStrip(maps, corners, e, n, -strip, samples, "textDensity")
        : 0;
      if (outerText > config.exteriorTextThreshold) s *= 0.6;
    }

    // Bottom: a stronger edge inside (true paper bottom above this line) means overshoot.
    if (e === 2) {
      let inwardPeak = innerMean;
      for (let d = strip * 2; d <= config.maxBorderSearch; d += strip) {
        inwardPeak = Math.max(
          inwardPeak,
          sampleEdgeStrip(maps, corners, e, n, d, samples, "magnitude"),
        );
      }
      if (inwardPeak > edgeMean * config.outwardEdgeRatio) s *= 0.35;

      const outerText = maps.textDensity
        ? sampleEdgeStrip(maps, corners, e, n, -strip, samples, "textDensity")
        : 0;
      if (outerText > config.exteriorTextThreshold) s *= 0.55;
    }

    edgeScores.push(Math.max(0, Math.min(1, s)));
  }

  return edgeScores.reduce((a, b) => a + b, 0) / edgeScores.length;
}

/** Mean normalised color + shadow response sampled along the four quad edges. */
function envelopeSupportScore(maps: FeatureMaps, corners: Quad, config: DetectionConfig): number {
  const { shadow, shadowMax, maxMagnitude } = maps;
  if (!shadow || !shadowMax || maxMagnitude === 0) return edgeScore(maps, corners, config);

  const sw = config.envelopeShadowScoreWeight;
  const cw = 1 - sw;
  let sum = 0;

  for (let e = 0; e < 4; e++) {
    const a = corners[e];
    const b = corners[(e + 1) % 4];
    let edgeSum = 0;
    for (let s = 0; s < config.edgeSamples; s++) {
      const t = (s + 0.5) / config.edgeSamples;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      const color = sampleField(maps.magnitude, maps.width, maps.height, x, y) / maxMagnitude;
      const sh = sampleField(shadow, maps.width, maps.height, x, y) / shadowMax;
      edgeSum += cw * color + sw * sh;
    }
    sum += edgeSum / config.edgeSamples;
  }

  return Math.min(1, sum / 4);
}

export function scoreComponents(maps: FeatureMaps, candidate: Candidate, config: DetectionConfig): ScoreComponents {
  const corners = orderCorners(candidate.corners);
  const edge = edgeScore(maps, corners, config);
  const area = areaScore(corners, maps);
  const aspectRatio = aspectRatioScore(corners, config);
  const { textDensity: rawTextDensity, consistency } = interiorSamples(maps, corners);
  const borderMargin = borderMarginScore(maps, corners, config);
  const envelopeSupport = envelopeSupportScore(maps, corners, config);
  // Saturate: once a quad contains enough text it is clearly a document, so additional density
  // must not pull the selection toward a tight crop of the densest region over the full page.
  const textDensity = Math.min(1, rawTextDensity / config.textDensitySaturation);

  const w = config.weights;
  const total =
    w.edge * edge +
    w.textDensity * textDensity +
    w.area * area +
    w.aspectRatio * aspectRatio +
    w.interiorConsistency * consistency +
    w.envelopeSupport * envelopeSupport +
    w.borderMargin * borderMargin;

  return {
    edge,
    textDensity,
    area,
    aspectRatio,
    interiorConsistency: consistency,
    envelopeSupport,
    borderMargin,
    total,
  };
}
