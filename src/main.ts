import "./style.css";
import { drawQuadOutline, type Quad } from "./documentScanner";
import { warpRgba } from "./warp/webglWarp";
import { scaleWorkerResult } from "./detection/fuseDetection";
import { scaleQuad } from "./detection/geometry";
import { capturePreviewRgba, PREVIEW_DETECT_MAX_DIM } from "./detection/previewFrame";
import type { DetectionResult, DetectionSourceSummary, StageTimings } from "./detection/types";
import { ParallelDetectionClient } from "./detection/worker/ParallelDetectionClient";
import type { WorkerDetectionResult } from "./detection/worker/types";
import { DEBUG_LAYERS, renderDebugLayers, type DebugLayer } from "./detection/debug/render";
import { DocumentTracker, type TrackingResult } from "./detection/tracker";

const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const uploadStatusEl = document.querySelector<HTMLParagraphElement>("#upload-status")!;
const modeWebcamBtn = document.querySelector<HTMLButtonElement>("#mode-webcam")!;
const modeUploadBtn = document.querySelector<HTMLButtonElement>("#mode-upload")!;
const webcamPanel = document.querySelector<HTMLElement>("#webcam-panel")!;
const uploadPanel = document.querySelector<HTMLElement>("#upload-panel")!;
const resultPanel = document.querySelector<HTMLElement>("#result-panel")!;
const video = document.querySelector<HTMLVideoElement>("#video")!;
const overlayCanvas = document.querySelector<HTMLCanvasElement>("#overlay-canvas")!;
const debugCanvas = document.querySelector<HTMLCanvasElement>("#debug-canvas")!;
const captureBtn = document.querySelector<HTMLButtonElement>("#capture-btn")!;
const fileInput = document.querySelector<HTMLInputElement>("#file-input")!;
const uploadCanvas = document.querySelector<HTMLCanvasElement>("#upload-canvas")!;
const resultCanvas = document.querySelector<HTMLCanvasElement>("#result-canvas")!;
const downloadLink = document.querySelector<HTMLAnchorElement>("#download-link")!;
const debugListEl = document.querySelector<HTMLDListElement>("#debug-list")!;
const debugLayersEl = document.querySelector<HTMLDivElement>("#debug-layers")!;

const overlayCtx = overlayCanvas.getContext("2d")!;
const debugCtx = debugCanvas.getContext("2d")!;
const uploadCtx = uploadCanvas.getContext("2d")!;

// Preview detection: small frames; ML-only when the model is loaded.
const LIVE_DETECT_INTERVAL_ML = 1;
const LIVE_DETECT_INTERVAL_CV = 3;
const EXPORT_MIN_DOCUMENT_WIDTH = 2400;
const UPLOAD_PREVIEW_MAX_WIDTH = 720;
const liveDetectCanvas = document.createElement("canvas");
const liveDetectCtx = liveDetectCanvas.getContext("2d")!;
const STABILITY_CAPTURE_THRESHOLD = 0.75;

function liveDetectInterval(): number {
  return detectionWorker?.isMlAvailable ? LIVE_DETECT_INTERVAL_ML : LIVE_DETECT_INTERVAL_CV;
}

async function detectAtPreviewResolution(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
): Promise<WorkerDetectionResult> {
  const frame = capturePreviewRgba(liveDetectCtx, liveDetectCanvas, source, srcWidth, srcHeight);
  const result = await detectionWorker.detectPreview(
    frame.width,
    frame.height,
    frame.data,
    frame.data.buffer,
  );
  return scaleWorkerResult(result, frame.toSourceScale, frame.toSourceScale);
}

let detectionWorker: ParallelDetectionClient;
let mediaStream: MediaStream | null = null;
let detectionLoopHandle: number | null = null;
let lastWebcamQuad: Quad | null = null;
let currentVideoTrack: MediaStreamTrack | null = null;
let lastFlattenedSize: { width: number; height: number } | null = null;

// Detection diagnostics surfaced in the debug panel.
let liveResult: DetectionResult | null = null;
let captureResult: DetectionResult | null = null;
let captureSrcWidth = 0;
let captureSrcHeight = 0;
let lastUploadImage: HTMLImageElement | null = null;
let lastUploadPreviewScale = 1;
let fps = 0;
let lastTickTime = 0;
let frameCounter = 0;
let detectionCycleCounter = 0;
let liveLoopGeneration = 0;
const activeLayers = new Set<DebugLayer>(["selected"]);

// Temporal tracker and its current output.
let tracker: DocumentTracker | null = null;
let trackingResult: TrackingResult | null = null;

// Live overlay debug toggles (separate from capture debug layers).
const liveOverlayLayers = new Set<"rawDetected" | "velocity" | "cvSource" | "mlSource">([
  "cvSource",
  "mlSource",
  "rawDetected",
]);

type Mode = "webcam" | "upload";

let activeMode: Mode = "webcam";

function setStatus(message: string): void {
  if (activeMode === "upload") {
    uploadStatusEl.textContent = message;
  } else {
    statusEl.textContent = message;
  }
}

function setMode(mode: Mode): void {
  activeMode = mode;
  modeWebcamBtn.classList.toggle("active", mode === "webcam");
  modeUploadBtn.classList.toggle("active", mode === "upload");
  webcamPanel.classList.toggle("hidden", mode !== "webcam");
  uploadPanel.classList.toggle("hidden", mode !== "upload");
  resultPanel.classList.add("hidden");

  if (mode === "webcam") {
    void startWebcam();
  } else {
    stopWebcam();
    renderDebugInfo();
  }
}

// Requested as an "ideal" floor; maximizeTrackResolution() below pushes the actual negotiated
// resolution up to the device's true max afterward, since browsers may otherwise settle for a
// lower default even when a high "ideal" is given.
const REQUESTED_WIDTH = 4096;
const REQUESTED_HEIGHT = 2160;

async function startWebcam(): Promise<void> {
  if (mediaStream) return;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: REQUESTED_WIDTH },
        height: { ideal: REQUESTED_HEIGHT },
      },
      audio: false,
    });
  } catch {
    setStatus("Could not access the webcam. Check permissions, or use Upload Image instead.");
    return;
  }
  // The user may have switched back to Upload mode while the permission prompt / camera was still
  // starting up — bail out without touching state.
  if (activeMode !== "webcam") {
    stream.getTracks().forEach((track) => track.stop());
    return;
  }
  mediaStream = stream;
  const [track] = stream.getVideoTracks();
  currentVideoTrack = track;
  await maximizeTrackResolution(track);

  video.srcObject = mediaStream;
  await video.play();

  if (activeMode !== "webcam") {
    stopWebcam();
    return;
  }

  overlayCanvas.width = video.videoWidth;
  overlayCanvas.height = video.videoHeight;
  debugCanvas.width = video.videoWidth;
  debugCanvas.height = video.videoHeight;
  debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);

  tracker = new DocumentTracker({ ticksBetweenDetections: liveDetectInterval() });

  captureBtn.disabled = true;
  setStatus("Looking for a document… hold it flat within the frame.");
  renderDebugInfo();
  runDetectionLoop();
}

/** Re-requests the track's resolution at the device's reported maximum, since "ideal" alone isn't always honored. */
async function maximizeTrackResolution(track: MediaStreamTrack): Promise<void> {
  const capabilities = track.getCapabilities?.();
  const maxWidth = capabilities?.width?.max;
  const maxHeight = capabilities?.height?.max;
  if (!maxWidth || !maxHeight) return;
  try {
    await track.applyConstraints({ width: { ideal: maxWidth }, height: { ideal: maxHeight } });
  } catch {
    // Device rejected the exact max — keep whatever resolution was already negotiated.
  }
}

function stopWebcam(): void {
  liveLoopGeneration++;
  detectionWorker.cancelLiveFrames();
  if (detectionLoopHandle !== null) {
    cancelAnimationFrame(detectionLoopHandle);
    detectionLoopHandle = null;
  }
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
  lastWebcamQuad = null;
  currentVideoTrack = null;
  liveResult = null;
  detectionCycleCounter = 0;
  trackingResult = null;
  tracker = null;
  captureBtn.disabled = true;
  if (activeMode === "webcam") debugListEl.replaceChildren();
}

function runDetectionLoop(): void {
  const scaleX = 1;
  const scaleY = 1;
  frameCounter = 0;
  detectionCycleCounter = 0;
  const loopGeneration = ++liveLoopGeneration;

  const tick = () => {
    if (loopGeneration !== liveLoopGeneration || activeMode !== "webcam" || !tracker) return;

    const now = performance.now();
    if (lastTickTime) fps = fps * 0.8 + (1000 / Math.max(1, now - lastTickTime)) * 0.2;
    lastTickTime = now;

    const cadence = liveDetectInterval();
    if (frameCounter % cadence === 0) {
      detectionCycleCounter++;
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const frame = capturePreviewRgba(liveDetectCtx, liveDetectCanvas, video, vw, vh);
      const toVideo = frame.toSourceScale;
      detectionWorker.submitLiveFrame(
        frame.width,
        frame.height,
        frame.data,
        frame.data.buffer,
        (result) => {
          if (loopGeneration !== liveLoopGeneration || activeMode !== "webcam" || !tracker) return;
          const scaled = scaleWorkerResult(result, toVideo, toVideo);
          liveResult = scaled;
          trackingResult = tracker.update(scaled);
          renderDebugInfo();
        },
      );
    } else {
      trackingResult = tracker.tick();
    }

    // Redraw overlay every frame so the tracker's smoothed quad is always current.
    renderLiveOverlay(scaleX, scaleY);

    frameCounter++;
    detectionLoopHandle = requestAnimationFrame(tick);
  };
  detectionLoopHandle = requestAnimationFrame(tick);
}

/** Draws CV / ML source quads when the corresponding debug layer is enabled. */
function drawParallelSourceQuads(
  ctx: CanvasRenderingContext2D,
  sources: DetectionResult["sources"],
  scaleX: number,
  scaleY: number,
): void {
  if (!sources) return;
  const scale = (quad: Quad) => quad.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY })) as Quad;
  if (liveOverlayLayers.has("cvSource") && sources.cv.quad) {
    drawQuadOutline(ctx, scale(sources.cv.quad), { stroke: "rgba(34,211,238,0.85)", lineWidth: 2, cornerRadius: 4 });
  }
  if (liveOverlayLayers.has("mlSource") && sources.ml?.quad) {
    drawQuadOutline(ctx, scale(sources.ml.quad), { stroke: "rgba(232,121,249,0.85)", lineWidth: 2, cornerRadius: 4 });
  }
}

function renderUploadPreview(image: HTMLImageElement, previewScale: number, result: DetectionResult | null): void {
  uploadCanvas.width = Math.round(image.width * previewScale);
  uploadCanvas.height = Math.round(image.height * previewScale);
  uploadCtx.drawImage(image, 0, 0, uploadCanvas.width, uploadCanvas.height);
  if (!result) return;
  drawParallelSourceQuads(uploadCtx, result.sources, previewScale, previewScale);
  if (liveOverlayLayers.has("rawDetected") && result.quad) {
    drawQuadOutline(uploadCtx, scaleQuad(result.quad, previewScale, previewScale), {
      stroke: "rgba(255,200,0,0.9)",
      lineWidth: 2.5,
      cornerRadius: 5,
    });
  }
}

/** Draws the tracker output onto the overlay canvas. */
function renderLiveOverlay(scaleX: number, scaleY: number): void {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!trackingResult) return;

  const tr = trackingResult;

  // Pre-fusion CV / ML quads (debug overlays).
  drawParallelSourceQuads(overlayCtx, liveResult?.sources, scaleX, scaleY);

  // Fused quad before tracking (yellow).
  if (liveOverlayLayers.has("rawDetected") && tr.rawDetectedQuad) {
    const rawScaled = tr.rawDetectedQuad.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY })) as Quad;
    drawQuadOutline(overlayCtx, rawScaled, { stroke: "rgba(255,200,0,0.65)", lineWidth: 1.5 });
  }

  // Smoothed/tracked quad — colour reflects the tracker state.
  if (tr.quad) {
    const scaledQuad = tr.quad.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY })) as Quad;
    lastWebcamQuad = scaledQuad;

    const stateColor =
      tr.state === "tracking"
        ? tr.stabilityScore >= STABILITY_CAPTURE_THRESHOLD
          ? "#22c55e" // bright green — capture-ready
          : "#4ade80" // softer green — tracking but not yet fully stable
        : tr.state === "detected"
          ? "#facc15" // yellow — first seen, confirming
          : "rgba(148,163,184,0.7)"; // gray — lost, showing last known position

    drawQuadOutline(overlayCtx, scaledQuad, { stroke: stateColor, lineWidth: tr.state === "tracking" ? 3 : 2 });

    // Corner velocity arrows (drawn over the quad).
    if (liveOverlayLayers.has("velocity") && tr.cornerDeltas) {
      drawVelocityArrows(overlayCtx, scaledQuad, tr.cornerDeltas, scaleX, scaleY);
    }
  }

  // Update status bar and capture readiness.
  updateStatusText(tr);
  const ready = tracker?.isCaptureReady() ?? false;
  captureBtn.disabled = !ready;
  captureBtn.textContent = ready ? "Capture" : "Hold steady…";
}

function drawVelocityArrows(
  ctx: CanvasRenderingContext2D,
  scaledQuad: Quad,
  deltas: TrackingResult["cornerDeltas"],
  scaleX: number,
  scaleY: number,
): void {
  if (!deltas) return;
  const SCALE = 8; // amplify tiny movements so they're visible

  ctx.save();
  ctx.strokeStyle = "rgba(255,100,100,0.85)";
  ctx.fillStyle = "rgba(255,100,100,0.85)";
  ctx.lineWidth = 1.5;

  for (let i = 0; i < 4; i++) {
    const cx = scaledQuad[i].x;
    const cy = scaledQuad[i].y;
    const dx = deltas[i].x * scaleX * SCALE;
    const dy = deltas[i].y * scaleY * SCALE;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;

    // Arrow shaft
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + dx, cy + dy);
    ctx.stroke();

    // Arrowhead
    const angle = Math.atan2(dy, dx);
    const headLen = Math.min(8, len * 0.4);
    ctx.beginPath();
    ctx.moveTo(cx + dx, cy + dy);
    ctx.lineTo(cx + dx - headLen * Math.cos(angle - 0.4), cy + dy - headLen * Math.sin(angle - 0.4));
    ctx.lineTo(cx + dx - headLen * Math.cos(angle + 0.4), cy + dy - headLen * Math.sin(angle + 0.4));
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

function updateStatusText(tr: TrackingResult): void {
  switch (tr.state) {
    case "searching":
      setStatus("Looking for a document… hold it flat within the frame.");
      break;
    case "detected":
      setStatus("Document detected — aligning…");
      break;
    case "tracking":
      setStatus(
        tr.stabilityScore >= STABILITY_CAPTURE_THRESHOLD
          ? "Document locked — ready to capture."
          : "Document tracked — stabilising… hold still.",
      );
      break;
    case "lost":
      setStatus("Document lost — searching…");
      break;
  }
}

async function captureAndFlatten(): Promise<void> {
  if (!tracker?.isCaptureReady() || !lastWebcamQuad) {
    setStatus("Hold the document steady until the outline turns bright green.");
    return;
  }

  setStatus("Capturing…");

  try {
    captureResult = await detectAtPreviewResolution(video, video.videoWidth, video.videoHeight);
    captureSrcWidth = video.videoWidth;
    captureSrcHeight = video.videoHeight;
    const quad = captureResult.quad ?? lastWebcamQuad;
    if (!quad) {
      setStatus("No document edges found — try repositioning and capture again.");
      return;
    }
    renderCaptureDebug();
    await warpAndShow(video, video.videoWidth, video.videoHeight, quad);
    renderDebugInfo();
  } catch {
    setStatus("Detection failed — try again.");
  }
}

async function warpAndShow(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  quad: Quad,
): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.width = srcWidth;
  canvas.height = srcHeight;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(source, 0, 0, srcWidth, srcHeight);
  const imageData = ctx.getImageData(0, 0, srcWidth, srcHeight);
  const warped = warpRgba(imageData.data, srcWidth, srcHeight, quad, {
    minOutputWidth: EXPORT_MIN_DOCUMENT_WIDTH,
  });
  showWarpedResult(warped.data, warped.width, warped.height);
}

function showWarpedResult(data: Uint8ClampedArray, width: number, height: number): void {
  resultCanvas.width = width;
  resultCanvas.height = height;
  resultCanvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  resultPanel.classList.remove("hidden");
  downloadLink.href = resultCanvas.toDataURL("image/png");
  downloadLink.download = `scanned-document-${width}x${height}.png`;
  lastFlattenedSize = { width, height };
}

/** Re-renders the selected debug layers from the most recent capture onto the debug canvas. */
function renderCaptureDebug(): void {
  if (!captureResult?.debug || debugCanvas.width === 0) {
    debugCtx.clearRect(0, 0, debugCanvas.width, debugCanvas.height);
    return;
  }
  renderDebugLayers(
    debugCtx,
    debugCanvas.width,
    debugCanvas.height,
    captureSrcWidth,
    captureResult.debug,
    captureResult.quad,
    activeLayers,
  );
}

async function handleFileSelected(): Promise<void> {
  const file = fileInput.files?.[0];
  if (!file) return;

  const image = await loadImageFile(file);
  lastUploadImage = image;
  const previewScale = Math.min(1, UPLOAD_PREVIEW_MAX_WIDTH / image.width);
  lastUploadPreviewScale = previewScale;

  setStatus("Detecting document…");
  renderUploadPreview(image, previewScale, null);

  try {
    captureResult = await detectAtPreviewResolution(image, image.width, image.height);
    captureSrcWidth = image.width;
    captureSrcHeight = image.height;
    renderUploadPreview(image, previewScale, captureResult);
    renderDebugInfo();

    const quad = captureResult.quad;
    if (!quad) {
      setStatus("No fused document edges found — see CV/ML quads in preview.");
      resultPanel.classList.add("hidden");
      return;
    }
    const conf = captureResult.confidence ? ` (fused ${captureResult.confidence.value.toFixed(2)})` : "";
    const detector = captureResult.detector ?? "cv";
    setStatus(`Document detected via ${detector}${conf}.`);
    await warpAndShow(image, image.width, image.height, quad);
  } catch {
    setStatus("Detection failed for this image.");
  }
}

function loadImageFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = URL.createObjectURL(file);
  });
}

/** Builds the debug-panel rows from camera / upload settings plus detection diagnostics. */
function renderDebugInfo(): void {
  const rows: [string, string][] = [
    ["ML detector", detectionWorker.isMlAvailable ? "ready" : "unavailable"],
    ["Export min width", `${EXPORT_MIN_DOCUMENT_WIDTH} px`],
  ];

  if (activeMode === "webcam" && currentVideoTrack) {
    const settings = currentVideoTrack.getSettings();
    const capabilities = currentVideoTrack.getCapabilities?.() ?? {};
    const deviceMaxResolution =
      capabilities.width?.max && capabilities.height?.max
        ? `${capabilities.width.max} × ${capabilities.height.max}`
        : "unknown";

    rows.unshift(
      ["Capture resolution", `${video.videoWidth} × ${video.videoHeight}`],
      ["Device max resolution", deviceMaxResolution],
      ["Frame rate", settings.frameRate ? `${settings.frameRate.toFixed(1)} fps` : "unknown"],
      ["Facing mode", settings.facingMode ?? "unknown"],
      ["Live detect size", `${liveDetectCanvas.width} × ${liveDetectCanvas.height} (max ${PREVIEW_DETECT_MAX_DIM}px)`],
      ["Live FPS", fps ? fps.toFixed(0) : "—"],
      ["Detection cadence", detectionWorker.isMlAvailable ? "every frame (ML)" : `every ${LIVE_DETECT_INTERVAL_CV} frames (CV)`],
      ["Detection thread", "web worker"],
      ["Worker status", detectionWorker.isLiveBusy ? "busy" : "idle"],
      ["Live detector", liveResult?.detector ?? "—"],
      ["Live detect mode", liveResult?.mode ?? "full"],
    );

    appendResultRows(rows, "Live", liveResult);
    if (liveResult?.sources) {
      appendParallelSourceRows(rows, "Live CV", liveResult.sources.cv);
      appendParallelSourceRows(rows, "Live ML", liveResult.sources.ml);
    }

    if (trackingResult) {
      const tr = trackingResult;
      rows.push(["Tracker state", tr.state]);
      rows.push(["Detection confidence", tr.detectionConfidence ? tr.detectionConfidence.toFixed(2) : "—"]);
      rows.push(["Tracking confidence", tr.trackingConfidence.toFixed(2)]);
      rows.push(["Stability score", tr.stabilityScore.toFixed(2)]);
      rows.push(["Corner velocity", tr.cornerVelocity ? `${tr.cornerVelocity.toFixed(1)} px/det` : "0"]);
    }
  }

  if (activeMode === "upload" && captureSrcWidth > 0) {
    rows.unshift(
      ["Upload image size", `${captureSrcWidth} × ${captureSrcHeight}`],
      ["Upload detect size", `${liveDetectCanvas.width} × ${liveDetectCanvas.height} (max ${PREVIEW_DETECT_MAX_DIM}px)`],
      ["Upload preview size", `${uploadCanvas.width} × ${uploadCanvas.height}`],
    );
  }

  if (captureResult && (activeMode === "upload" || captureResult.debug)) {
    const uploadLabel = activeMode === "upload" ? "Upload" : "Capture";
    rows.push([`${uploadLabel} detector`, captureResult.detector ?? "—"]);
    appendResultRows(rows, uploadLabel, captureResult);
    appendParallelSourceRows(rows, `${uploadLabel} CV`, captureResult.sources?.cv ?? null);
    appendParallelSourceRows(rows, `${uploadLabel} ML`, captureResult.sources?.ml ?? null);
  }

  if (lastFlattenedSize) {
    rows.push(["Last flattened size", `${lastFlattenedSize.width} × ${lastFlattenedSize.height}`]);
  }

  if (rows.length <= 2 && activeMode === "webcam" && !currentVideoTrack) {
    debugListEl.replaceChildren();
    return;
  }

  debugListEl.replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      return [dt, dd];
    }),
  );
}

/** Appends a result's timing, confidence, and per-component scores to the debug rows. */
function appendResultRows(rows: [string, string][], label: string, result: DetectionResult | null): void {
  if (!result) return;
  rows.push([`${label} detect time`, `${sumTimings(result)} ms`]);
  rows.push([`${label} confidence`, result.confidence ? result.confidence.value.toFixed(2) : "—"]);
  const c = result.components;
  if (c) {
    rows.push(["  edge / textDens", `${c.edge.toFixed(2)} / ${c.textDensity.toFixed(2)}`]);
    rows.push(["  area / aspect", `${c.area.toFixed(2)} / ${c.aspectRatio.toFixed(2)}`]);
    rows.push(["  interior / border", `${c.interiorConsistency.toFixed(2)} / ${c.borderMargin.toFixed(2)}`]);
    rows.push(["  envelope / total", `${c.envelopeSupport.toFixed(2)} / ${c.total.toFixed(2)}`]);
  }
  rows.push([`${label} stages (ms)`, stageString(result)]);
}

function sumTimings(result: DetectionResult): number {
  return Math.round(Object.values(result.timings).reduce((a, b) => a + b, 0));
}

function stageString(result: DetectionResult): string {
  return Object.entries(result.timings)
    .map(([k, v]) => `${k.slice(0, 4)} ${Math.round(v)}`)
    .join(", ");
}

function formatQuadCorners(quad: Quad | null): string {
  if (!quad) return "none";
  const [tl, tr, br, bl] = quad;
  const p = (pt: { x: number; y: number }) => `${Math.round(pt.x)},${Math.round(pt.y)}`;
  return `TL ${p(tl)} · TR ${p(tr)} · BR ${p(br)} · BL ${p(bl)}`;
}

function sumSourceTimings(timings: StageTimings): number {
  return Math.round(Object.values(timings).reduce((a, b) => a + b, 0));
}

function appendParallelSourceRows(
  rows: [string, string][],
  label: string,
  source: DetectionSourceSummary | null,
): void {
  if (!source) {
    rows.push([`${label} quad`, "unavailable"]);
    return;
  }
  rows.push([`${label} quad`, formatQuadCorners(source.quad)]);
  rows.push([`${label} confidence`, source.confidence !== null ? source.confidence.toFixed(2) : "—"]);
  rows.push([`${label} time`, `${sumSourceTimings(source.timings)} ms`]);
  if (source.components) {
    rows.push([`${label} score`, source.components.total.toFixed(2)]);
  }
}

/** Builds the capture-mode debug layer toggles. */
function buildLayerToggles(): void {
  debugLayersEl.replaceChildren(
    ...DEBUG_LAYERS.map(({ id, label }) => {
      const wrapper = document.createElement("label");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = activeLayers.has(id);
      input.addEventListener("change", () => {
        if (input.checked) activeLayers.add(id);
        else activeLayers.delete(id);
        renderCaptureDebug();
      });
      const span = document.createElement("span");
      span.textContent = label;
      wrapper.append(input, span);
      return wrapper;
    }),
    ...buildLiveLayerToggles(),
  );
}

/** Returns toggle elements for the live overlay layers (raw detected quad, velocity arrows). */
function buildLiveLayerToggles(): HTMLLabelElement[] {
  const liveLayerDefs: { id: "rawDetected" | "velocity" | "cvSource" | "mlSource"; label: string }[] = [
    { id: "cvSource", label: "CV quad (cyan)" },
    { id: "mlSource", label: "ML quad (magenta)" },
    { id: "rawDetected", label: "Fused quad (yellow)" },
    { id: "velocity", label: "Corner velocity vectors (webcam)" },
  ];
  return liveLayerDefs.map(({ id, label }) => {
    const wrapper = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = liveOverlayLayers.has(id);
    input.addEventListener("change", () => {
      if (input.checked) liveOverlayLayers.add(id);
      else liveOverlayLayers.delete(id);
      if (activeMode === "upload" && lastUploadImage) {
        renderUploadPreview(lastUploadImage, lastUploadPreviewScale, captureResult);
      }
    });
    const span = document.createElement("span");
    span.textContent = label;
    wrapper.append(input, span);
    return wrapper;
  });
}

modeWebcamBtn.addEventListener("click", () => setMode("webcam"));
modeUploadBtn.addEventListener("click", () => setMode("upload"));
captureBtn.addEventListener("click", () => void captureAndFlatten());
fileInput.addEventListener("change", () => void handleFileSelected());

async function init(): Promise<void> {
  setStatus("Loading detectors…");
  detectionWorker = new ParallelDetectionClient();
  await detectionWorker.whenReady();
  const mlStatus = detectionWorker.isMlAvailable ? "ML detector ready" : "ML detector unavailable (CV only)";
  setStatus(`${mlStatus}. OpenCV loads only if CV fallback is needed.`);
  buildLayerToggles();
  setMode("webcam");
}

void init();
