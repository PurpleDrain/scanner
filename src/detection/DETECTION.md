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
| Perspective correction | `warp/webglWarp.ts` (`warpRgba`) | flattened image |

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

`score = wE·edge + wT·textDensity + wA·area + wR·aspectRatio + wC·interiorConsistency + wV·envelopeSupport + wB·borderMargin`
(weights in `config.ts`, default `0.17 / 0.08 / 0.10 / 0.05 / 0.08 / 0.20 / 0.32` — border margin dominates).

- **edge** — mean gradient magnitude sampled along the four edges, normalised. A real border runs
  along strong gradients; a quad cutting across flat regions scores low.
- **textDensity** — mean interior text likelihood (adaptive-threshold + connected components in the
  glyph-size band), **saturating**: once a quad clearly contains text, more density doesn't reward
  cropping tighter, so the complete page wins over a tight crop of the densest paragraph.
- **area** — fraction of the frame covered; documents are large.
- **aspectRatio** — plausibility of the long/short side ratio (paper-like, perspective-tolerant).
- **interiorConsistency** — interior luminance uniformity in Lab; pages are smooth between glyphs.
- **borderMargin** — each edge should be a physical page border, not an interior text line (top
  snaps) or a quad that overshoots the paper onto the desk (bottom). Penalises strong parallel
  gradients just inside/outside the edge and dense text immediately below the top border.
- **envelopeSupport** — mean shadow + color response along the quad border; matches the
  document-shaped blob visible in the color-edge and shadow debug layers.

**Candidate sources:** Hough line intersections (interior lines can dominate) plus an
**envelope contour** extracted from the combined color/shadow mask (`candidates/envelope.ts`).
`selectWinner()` re-ranks near-top candidates using a **border-fit** score (border margin +
edge strength, with a penalty for oversized desk-inclusive quads) rather than blindly preferring
the largest envelope-backed rectangle. After selection, `refineQuadToEdges()` nudges each edge
toward the strongest parallel gradient to shrink overshoot onto the desk.

**Confidence** (`scoring/confidence.ts`, 0..1) combines edge strength (including envelope support), quad validity
(rectangularity), score gap to the runner-up, text density, and aspect-ratio plausibility. It is
the natural hook for prompting manual corner adjustment when low.

## Multi-scale

Full mode runs the pipeline at 25 / 50 / 100 % of the base processing dimension and keeps the scale
whose winner has the highest confidence. Coarse scales suppress interior text and find large/near
pages; the fine scale localises edges. All scoring components are scale-invariant fractions, so
confidence is comparable across scales.

## Modes & performance

Accuracy is prioritised over speed. Defaults process up to **2560 px** (live worker **2048 px**,
capture/upload worker **4096 px** native longest side) with **six** multi-scale passes, dense Hough
voting, and multi-pass edge + corner refinement on the finest feature maps.

- **`preview`** — multi-scale live search with shadow envelope + text-density scoring.
- **`full`** — full multi-scale search; when `debug: true`, debug buffers are emitted.

### Web worker (live + capture)

Heavy OpenCV work runs in a dedicated module worker (`detection/worker/detectionWorker.ts`).
The main thread keeps the camera preview, overlay, and `DocumentTracker` smooth; frames are
sent as transferable RGBA buffers (`matFromRgba` builds the Mat inside the worker).

Live detection uses **`preview` mode** with `LIVE_WORKER_CONFIG`: one scale at 640 px longest
side, envelope + Hough (no surface sweep, no finest-scale re-pass). Capture and upload use
**`full` multi-scale** with `CAPTURE_WORKER_CONFIG` (up to 2560 px, four scales, surface
candidates, finest-scale edge snap) and `debug: true`. If a new frame arrives while the worker
is busy, only the latest frame is queued.

OpenCV loads **only in the CV worker** when ML is unavailable. Perspective flattening uses **WebGL** on the main thread (`warp/webglWarp.ts`) — no OpenCV needed for export when ML handles detection.

## Temporal tracking (live webcam)

`DocumentTracker` (`tracker.ts`) sits between the detection worker and the UI overlay. The live
loop posts frames to the worker every N animation frames; when a result arrives it calls
`tracker.update()`. On skipped frames it calls `tracker.tick()` for confidence decay only.

Confirmation (`detected` → `tracking`) counts **consecutive good detection cycles** in `update()`,
not animation frames between them — so throttling does not block the state machine. Capture is
enabled when `isCaptureReady()` is true (`tracking` + stability ≥ 0.75).

## Parallel ML detection (DocAligner LCNet100)

Two web workers:

1. **CV worker** — OpenCV color+Hough pipeline (`detectionWorker.ts`).
2. **ML worker** — DocAligner LCNet100 corner-heatmap model via `onnxruntime-web` (`mlDetectionWorker.ts`).

| Path | CV | ML |
|------|----|----|
| **Live preview** | skipped | ML-only fast path |
| **Upload / capture** | same as live fallback | same preview path |

All detection paths downscale to **480 px** max dimension (quad scaled back to source space), run **ML-only** when the model is loaded, and use the CV live worker profile as fallback. Upload and webcam capture use `detectPreview()` — identical to the live overlay path.

Fusion (when both paths contribute, e.g. CV fallback shell + ML):

- **ML wins** whenever it returns a quad with confidence ≥ 0.2.
- **CV is the fallback** when ML is unavailable, finds nothing, or is below threshold.

Model: `public/models/lcnet100_h_e_bifpn_256_fp32.onnx` (Apache 2.0, [DocsaidLab DocAligner](https://github.com/DocsaidLab/DocAligner), re-hosted via [pagescan-weights](https://huggingface.co/7rplus/pagescan-weights)). ONNX Runtime WASM binaries are bundled via Vite `?url` imports from `onnxruntime-web`.

The debug panel shows **ML detector** readiness, which path won fusion (`cv` / `ml`), and separate CV/ML quads in overlays.

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
