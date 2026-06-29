# Document Scanner PoC

A proof-of-concept document scanner that runs entirely in the browser. It
detects a document's edges in a webcam feed or uploaded photo, draws the
outline live, and produces a perspective-corrected ("flattened") crop —
similar to apps like CamScanner or Apple Notes' built-in scanner.

## Stack

- **TypeScript + Vite** for the app shell.
- **[OpenCV.js](https://docs.opencv.org/4.x/d5/d10/tutorial_js_root.html)**
  (via [`@techstark/opencv-js`](https://www.npmjs.com/package/@techstark/opencv-js),
  an npm-packaged build with TypeScript types) for the actual computer vision.

## How detection works

See `src/documentScanner.ts`:

1. Convert the frame to grayscale and blur it (`GaussianBlur`) to suppress noise.
2. Run Canny edge detection, then dilate the edges slightly to close small gaps.
3. Find all contours (`findContours`) and, sorted by area, look for the
   largest one that approximates to a convex 4-point polygon
   (`approxPolyDP` + `isContourConvex`) covering at least 10% of the frame.
4. Order the 4 points as top-left/top-right/bottom-right/bottom-left.
5. Draw that quadrilateral as the live outline overlay.
6. On capture, run `getPerspectiveTransform` + `warpPerspective` to map the
   quad onto an upright rectangle sized to its measured width/height.

This is the standard approach used by most real scanner apps (e.g. the OSS
[jscanify](https://github.com/puffinsoft/jscanify) library wraps the same
OpenCV building blocks).

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

- Detection is a classical edge/contour heuristic, not a learned model — it
  works best against a reasonably contrasting background and can miss edges
  in low contrast, cluttered, or curled-page scenes.
- No multi-page batching, OCR, or image enhancement (contrast/binarization)
  of the final crop — out of scope for this PoC.
- The live webcam loop processes a downscaled frame for performance; the
  full-resolution frame is only re-analyzed at capture time.
