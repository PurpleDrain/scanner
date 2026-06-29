# Document Detection Pipeline

A color-aware, multi-scale document detector built on OpenCV.js. It is designed to find a
document's four corners even when the page has **weak luminance contrast** against its background
(e.g. cream paper on a cream desk) — the case where a classic grayscale edge/contour detector
fails completely.

## Why color

Detecting a page edge from luminance alone fails when paper and surface share brightness. On the
project's real test photo (`test_data/IMG_3004.jpg`), the left/right page edges have **near-zero
luminance contrast** (desk L ≈ paper L) yet a **consistent ~4-unit step in CIELAB's `b` channel**
(the desk is warmer/yellower than the paper). Converting to Lab and running the Sobel operator on
each channel, then combining with chroma weighted up, recovers those edges. This is the core idea
of the pipeline; everything else makes it robust and selective.

## Architecture

Four stages with stable interfaces so a future ML model can replace any one of them:

```
            feature extraction        candidate generation        candidate scoring        perspective
  RGBA  ─▶  FeatureMaps         ─▶     Line[] ─▶ Candidate[]  ─▶    ScoredCandidate[]   ─▶   warp (documentScanner)
```

| Stage | Module(s) | Output |
|-------|-----------|--------|
| Feature extraction | `features/colorGradient.ts`, `features/textDensity.ts`, `features/shadowEdges.ts`, `features/index.ts` | `FeatureMaps` (gradient magnitude+direction, per-channel L/a/b gradients, text-density, shadow, Lab) |
| Candidate generation | `candidates/hough.ts`, `candidates/quads.ts` | candidate lines → valid quadrilaterals |
| Candidate scoring | `scoring/components.ts`, `scoring/confidence.ts`, `scoring/index.ts` | scored candidates + confidence |
| Orchestration | `detectDocument.ts`, `multiScale.ts`, `profiler.ts` | `DetectionResult` |
| Perspective correction | `documentScanner.ts` (`warpDocument`) | flattened image |

Shared types live in `types.ts`, geometry helpers in `geometry.ts`, tunables in `config.ts`,
debug rendering in `debug/render.ts`.

### Pipeline

1. **Downscale + grayscale-free feature extraction.** Resize to the processing dimension (text
   shrinks below the edge scale, suppressing interior noise), convert RGBA→Lab, Gaussian-blur and
   Sobel each of L, a, b. Combine into a single chroma-weighted gradient magnitude + direction.
2. **Gradient-weighted Hough transform.** Each pixel votes (weighted by magnitude) for lines in
   Hesse normal form, but only for angles near-perpendicular to its gradient — sharp accumulator,
   cheap. Non-max suppression yields candidate lines.
3. **Quadrilateral enumeration.** Lines split into two near-perpendicular orientation groups; pick
   2 from each, intersect into 4 corners, keep geometrically valid quads (convex, plausible area,
   near-rectangular, roughly in frame).
4. **Scoring + confidence.** Each quad gets component scores; the best is chosen; confidence is
   reported. Corners map back to source coordinates and are canonicalised to TL/TR/BR/BL.

## Scoring components

`score = wE·edge + wT·textDensity + wA·area + wR·aspectRatio + wC·interiorConsistency`
(weights in `config.ts`, default `0.35 / 0.15 / 0.25 / 0.10 / 0.15`).

- **edge** — mean gradient magnitude sampled along the four edges, normalised. A real border runs
  along strong gradients; a quad cutting across flat regions scores low.
- **textDensity** — mean interior text likelihood (adaptive-threshold + connected components in the
  glyph-size band), **saturating**: once a quad clearly contains text, more density doesn't reward
  cropping tighter, so the complete page wins over a tight crop of the densest paragraph.
- **area** — fraction of the frame covered; documents are large.
- **aspectRatio** — plausibility of the long/short side ratio (paper-like, perspective-tolerant).
- **interiorConsistency** — interior luminance uniformity in Lab; pages are smooth between glyphs.

**Confidence** (`scoring/confidence.ts`, 0..1) combines edge strength, quad validity
(rectangularity), score gap to the runner-up, text density, and aspect-ratio plausibility. It is
the natural hook for prompting manual corner adjustment when low.

## Multi-scale

Full mode runs the pipeline at 25 / 50 / 100 % of the base processing dimension and keeps the scale
whose winner has the highest confidence. Coarse scales suppress interior text and find large/near
pages; the fine scale localises edges. All scoring components are scale-invariant fractions, so
confidence is comparable across scales.

## Modes & performance

- **`preview`** (live frames): single low-resolution pass, color gradient + Hough + light scoring;
  skips text-density/shadow/multi-scale.
- **`full`** (capture/upload): multi-scale, full feature set, interior scoring, confidence, and —
  when `debug: true` — debug buffers.

Measured in this environment (Node + OpenCV.js, 480×640 input — the live processing size):

| Mode | Median latency | Throughput |
|------|----------------|------------|
| preview | ~17 ms | ~58 fps |
| full (multi-scale) | ~45 ms | one-shot at capture |

Per-stage (full, real photo): features ~79 ms, hough ~32 ms, candidates ~3 ms, scoring ~8 ms —
feature extraction dominates. These are desktop numbers; on-device mobile FPS must be verified on a
physical phone, but the preview budget leaves comfortable headroom for the 30 fps target. The
live/full split, Mat reuse, and typed-array fields keep allocations down.

## Debug visualization

The debug panel (webcam mode) renders independently-toggleable layers over the stage, populated on
capture: color edge map, L/a/b gradients, text-density map, shadow edges, Hough accumulator
heatmap, detected lines, candidate quads, and the selected quad — plus numeric rows for capture/
processing resolution, FPS, per-stage timings, confidence, and the individual component scores.

## Tuning

All thresholds live in `DEFAULT_DETECTION_CONFIG` (`config.ts`). Notable knobs: `chromaWeight`
(color-vs-luminance emphasis), `scales`, `weights`, `textDensitySaturation`, Hough
`voteAngleWindow` / `magVoteFraction`, and the quad validity bounds.

## Known limitation

When a page edge has *truly* near-zero contrast in **all** channels and a strong competing interior
line is nearby (e.g. the blank-header top of `IMG_3004.jpg`, where the text block's top edge is far
stronger than the faint page top), that edge can snap to the interior line. The detector still
recovers the other three edges reliably — a large improvement over the previous grayscale detector,
which found nothing — and the reported confidence flags such cases for manual correction.

## Verification

- `npx vitest run` — unit tests in `__tests__/` cover the color-only-edge recovery, document
  detection on a contrasting background (perspective + axis-aligned), corner ordering, preview vs
  full, debug emission, timings, text density, and geometry.
- Real-image check: run the full pipeline on `test_data/IMG_3004.jpg` (decode via Pillow to RGBA,
  load into a Mat, call `detectDocument`) and confirm a quad whose left/right/bottom edges track the
  page.
