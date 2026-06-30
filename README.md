# Document Scanner PoC

A proof-of-concept document scanner that runs entirely in the browser. It
detects a document's edges in a webcam feed or uploaded photo, draws the
outline live, and produces a perspective-corrected ("flattened") crop —
similar to apps like CamScanner or Apple Notes' built-in scanner.

## Stack

- **TypeScript + Vite** for the app shell.
- **[onnxruntime-web](https://onnxruntime.ai/)** running the
  [DocAligner LCNet100](https://github.com/DocsaidLab/DocAligner) corner-detection
  model on-device for document detection (in a web worker).
- **WebGL** for perspective flattening, and **Canvas2D / pure JS** for the quality
  metrics and auto-contrast enhancement. No OpenCV.

## How detection works

See `src/detection/DETECTION.md` for the full pipeline. In short:

1. The webcam frame / uploaded image is downscaled to ≤480 px and sent to the ML worker.
2. The DocAligner model predicts the four document corners, post-processed into an
   ordered quad (top-left/top-right/bottom-right/bottom-left) plus a confidence.
3. The quad is scaled back to source coordinates and (for the webcam) smoothed by a
   temporal tracker, then drawn as the live outline overlay.
4. After capture or upload, you can drag the corners in the editor, then flatten:
   a WebGL homography warp maps the quad onto an upright rectangle, the result is
   quality-scored, and auto-contrast enhancement is applied before download.

## Running it

```sh
npm install
npm run dev
```

Open the printed local URL. Allow camera access for the **Webcam** mode, or
switch to **Upload Image** to test against a static photo. Click
**Capture & Flatten** (webcam) or simply upload a file to see the detected
outline and the resulting flattened crop, which can be downloaded as a PNG.

## Known PoC limitations

- Detection relies entirely on the ML model; if it fails to load (unsupported
  browser, fetch error) there is no classical fallback.
- No multi-page batching or OCR — out of scope for this PoC.
- Both the live loop and capture/upload detect on a downscaled (≤480 px) frame
  for speed; the full-resolution frame is only used for the final flatten/export.
