# Document Detection Pipeline

Document detection runs entirely on a learned model — **DocAligner LCNet100**, a corner-heatmap
network executed in the browser via `onnxruntime-web`. There is no OpenCV/classical CV path; the
main thread is dependency-light and all heavy work happens in a web worker.

## Architecture

```
  RGBA frame  ─▶  downscale (≤480px)  ─▶  ML worker (ONNX)  ─▶  Quad (TL/TR/BR/BL)  ─▶  WebGL warp
```

| Stage | Module(s) | Output |
|-------|-----------|--------|
| Frame capture / downscale | `previewFrame.ts` | small RGBA frame + scale-back factor |
| ML detection | `ml/mlDetectionWorker.ts`, `ml/docAlignerModel.ts`, `ml/heatmap.ts` | corner heatmaps → `Quad` + confidence |
| Client orchestration | `worker/ParallelDetectionClient.ts`, `ml/MlDetectionClient.ts` | `WorkerDetectionResult` |
| Result shaping | `fuseDetection.ts` | scale quad back to source space |
| Temporal smoothing | `tracker.ts` | smoothed quad + capture readiness |
| Perspective correction | `warp/webglWarp.ts` (`warpRgba`), `warp/homography.ts` | flattened image |

Shared types live in `types.ts`; geometry helpers in `geometry.ts`.

## Output sizing / aspect ratio

`warpOutputSize` derives the flattened image dimensions. When the source image size is
supplied (as it is from `warpRgba`), it recovers the document's true width/height ratio from
the perspective projection via a pinhole-camera model (`recoverAspectRatio`, Zhang & He 2007)
instead of the foreshortened visible edge lengths. This prevents angled captures from coming
out squished. Near-fronto-parallel or degenerate quads fall back to the edge-length ratio.

## How detection works

1. **Downscale.** The video frame / uploaded image is drawn to a small canvas (≤480 px longest
   side) and read back as an RGBA buffer (`capturePreviewRgba`). The scale factor is retained to map
   the detected quad back to source coordinates.
2. **ML inference (worker).** The RGBA buffer is transferred to the ML worker, which runs the
   DocAligner model and post-processes the corner heatmaps into four ordered corners plus an
   aggregate confidence (`postprocessHeatmaps` / `heatmap.ts`).
3. **Scale back.** `scaleWorkerResult` maps the quad from the downscaled frame back to source/video
   space.
4. **Track (live only).** `DocumentTracker` smooths the quad across frames and reports capture
   readiness.

A detection is considered usable when the model returns a quad with confidence ≥ 0.2
(`fuseDetection.ts`); otherwise the result is treated as "nothing found".

## Paths

| Path | Detection |
|------|-----------|
| **Live preview** | `submitLiveFrame()` every animation frame — newest frame queued while the worker is busy |
| **Upload / capture** | `detectPreview()` — the same downscale + ML inference, awaited once |

All three paths share the identical downscale-and-detect code, so the capture/upload quad matches
what the live overlay showed.

## Temporal tracking (live webcam)

`DocumentTracker` (`tracker.ts`) sits between the detection worker and the UI overlay. The live loop
captures and posts a frame to the worker on every animation frame; when a result arrives it calls
`tracker.update()`. While the worker is busy it calls `tracker.tick()` for confidence decay only.

Confirmation (`detected` → `tracking`) counts **consecutive good detection cycles** in `update()`,
not animation frames between them — so throttling does not block the state machine. Capture is
enabled when `isCaptureReady()` is true (`tracking` + stability ≥ threshold).

Once stability is high, corner smoothing tightens so small ML jitter is ignored and the
capture-ready state does not flicker. A deliberate large move (user repositions the phone or
document) snaps the overlay quickly, relaxes the per-corner jump limit, and lowers stability so
the user must hold steady again before capture.

## Model

`public/models/lcnet100_h_e_bifpn_256_fp32.onnx` (Apache 2.0,
[DocsaidLab DocAligner](https://github.com/DocsaidLab/DocAligner), re-hosted via
[pagescan-weights](https://huggingface.co/7rplus/pagescan-weights)). ONNX Runtime WASM binaries are
bundled via Vite `?url` imports from `onnxruntime-web`.

If the model fails to load (unsupported browser, fetch error), detection is unavailable — there is
no classical fallback.

## Verification

- `npx vitest run` — unit tests in `__tests__/` cover heatmap post-processing, bilinear resize,
  corner ordering / geometry, the preview-frame downscale math, and the temporal tracker state
  machine.
