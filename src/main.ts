import "./style.css";
import { loadOpenCv } from "./opencv";
import { drawQuadOutline, warpDocument, type Quad } from "./documentScanner";
import { detectDocument } from "./detection/detectDocument";
import type { DetectionResult } from "./detection/types";
import { DEBUG_LAYERS, renderDebugLayers, type DebugLayer } from "./detection/debug/render";
import { DocumentTracker, type TrackingResult } from "./detection/tracker";
import type { CV, Mat as CvMat } from "@techstark/opencv-js";

const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
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

// Live preview detection runs on a downscaled offscreen frame for performance; the resulting
// quad is rescaled back up to the overlay/full-res coordinate space.
const PROCESSING_WIDTH = 480;
// The full detection pipeline runs every Nth animation frame; tracking interpolates between runs.
const DETECTION_FRAME_INTERVAL = 10;
const processingCanvas = document.createElement("canvas");
const processingCtx = processingCanvas.getContext("2d")!;

let cv: CV;
let mediaStream: MediaStream | null = null;
let detectionLoopHandle: number | null = null;
let lastWebcamQuad: Quad | null = null;
let currentVideoTrack: MediaStreamTrack | null = null;
let lastFlattenedSize: { width: number; height: number } | null = null;

// Detection diagnostics surfaced in the debug panel.
let liveResult: DetectionResult | null = null;
let captureResult: DetectionResult | null = null;
let captureSrcWidth = 0;
let fps = 0;
let lastTickTime = 0;
let frameCounter = 0;
const activeLayers = new Set<DebugLayer>(["selected"]);

// Temporal tracker and its current output.
let tracker: DocumentTracker | null = null;
let trackingResult: TrackingResult | null = null;

// Live overlay debug toggles (separate from capture debug layers).
const liveOverlayLayers = new Set<"rawDetected" | "velocity">();

type Mode = "webcam" | "upload";

let activeMode: Mode = "webcam";

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
    statusEl.textContent = "Could not access the webcam. Check permissions, or use Upload Image instead.";
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
  const scale = PROCESSING_WIDTH / video.videoWidth;
  processingCanvas.width = PROCESSING_WIDTH;
  processingCanvas.height = Math.round(video.videoHeight * scale);

  tracker = new DocumentTracker();

  captureBtn.disabled = false;
  statusEl.textContent = "Looking for a document… hold it flat within the frame.";
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
  if (detectionLoopHandle !== null) {
    cancelAnimationFrame(detectionLoopHandle);
    detectionLoopHandle = null;
  }
  mediaStream?.getTracks().forEach((track) => track.stop());
  mediaStream = null;
  lastWebcamQuad = null;
  currentVideoTrack = null;
  liveResult = null;
  trackingResult = null;
  tracker = null;
  captureBtn.disabled = true;
  debugListEl.replaceChildren();
}

function runDetectionLoop(): void {
  const scaleX = overlayCanvas.width / processingCanvas.width;
  const scaleY = overlayCanvas.height / processingCanvas.height;
  frameCounter = 0;

  const tick = () => {
    const now = performance.now();
    if (lastTickTime) fps = fps * 0.8 + (1000 / Math.max(1, now - lastTickTime)) * 0.2;
    lastTickTime = now;

    if (frameCounter % DETECTION_FRAME_INTERVAL === 0) {
      // Run the full detection pipeline and update the tracker with the fresh result.
      processingCtx.drawImage(video, 0, 0, processingCanvas.width, processingCanvas.height);
      const src = cv.imread(processingCanvas);
      try {
        liveResult = detectDocument(cv, src, { mode: "full" });
        trackingResult = tracker!.update(liveResult);
      } finally {
        src.delete();
      }
      renderDebugInfo();
    } else {
      // No new detection; advance the tracker's internal state (confidence decay, etc.)
      trackingResult = tracker!.tick();
    }

    // Redraw overlay every frame so the tracker's smoothed quad is always current.
    renderLiveOverlay(scaleX, scaleY);

    frameCounter++;
    detectionLoopHandle = requestAnimationFrame(tick);
  };
  detectionLoopHandle = requestAnimationFrame(tick);
}

/** Draws the tracker output onto the overlay canvas. */
function renderLiveOverlay(scaleX: number, scaleY: number): void {
  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!trackingResult) return;

  const tr = trackingResult;

  // Raw detected quad (yellow, thin) — drawn first so the smoothed quad renders on top.
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
        ? tr.stabilityScore > 0.7
          ? "#22c55e" // bright green — highly stable
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

  // Update status bar.
  updateStatusText(tr);
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
      statusEl.textContent = "Looking for a document… hold it flat within the frame.";
      break;
    case "detected":
      statusEl.textContent = "Document detected — aligning…";
      break;
    case "tracking":
      statusEl.textContent =
        tr.stabilityScore > 0.75
          ? "Document locked — ready to capture."
          : "Document tracked — stabilising…";
      break;
    case "lost":
      statusEl.textContent = "Document lost — searching…";
      break;
  }
}

function captureAndFlatten(): void {
  const fullCanvas = document.createElement("canvas");
  fullCanvas.width = video.videoWidth;
  fullCanvas.height = video.videoHeight;
  fullCanvas.getContext("2d")!.drawImage(video, 0, 0);

  const src = cv.imread(fullCanvas);
  try {
    // Full multi-scale detection with debug buffers for the captured still.
    captureResult = detectDocument(cv, src, { mode: "full", debug: true });
    captureSrcWidth = fullCanvas.width;
    const quad = captureResult.quad ?? lastWebcamQuad;
    if (!quad) {
      statusEl.textContent = "No document edges found — try repositioning and capture again.";
      return;
    }
    renderCaptureDebug();
    showWarpedResult(src, quad);
    renderDebugInfo();
  } finally {
    src.delete();
  }
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

function showWarpedResult(src: CvMat, quad: Quad): void {
  const warped = warpDocument(cv, src, quad);
  try {
    resultCanvas.width = warped.cols;
    resultCanvas.height = warped.rows;
    cv.imshow(resultCanvas, warped);
    resultPanel.classList.remove("hidden");
    downloadLink.href = resultCanvas.toDataURL("image/png");
    lastFlattenedSize = { width: warped.cols, height: warped.rows };
  } finally {
    warped.delete();
  }
}

async function handleFileSelected(): Promise<void> {
  const file = fileInput.files?.[0];
  if (!file) return;

  const image = await loadImageFile(file);
  const maxDisplayWidth = 720;
  const scale = Math.min(1, maxDisplayWidth / image.width);
  uploadCanvas.width = Math.round(image.width * scale);
  uploadCanvas.height = Math.round(image.height * scale);
  uploadCtx.drawImage(image, 0, 0, uploadCanvas.width, uploadCanvas.height);

  const src = cv.imread(uploadCanvas);
  try {
    captureResult = detectDocument(cv, src, { mode: "full", debug: true });
    const quad = captureResult.quad;
    if (!quad) {
      statusEl.textContent = "No document edges found in this image.";
      resultPanel.classList.add("hidden");
      return;
    }
    drawQuadOutline(uploadCtx, quad);
    const conf = captureResult.confidence ? ` (confidence ${captureResult.confidence.value.toFixed(2)})` : "";
    statusEl.textContent = `Document detected${conf}.`;
    showWarpedResult(src, quad);
  } finally {
    src.delete();
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

/** Builds the debug-panel rows from camera settings plus live/capture detection diagnostics. */
function renderDebugInfo(): void {
  if (!currentVideoTrack) {
    debugListEl.replaceChildren();
    return;
  }

  const settings = currentVideoTrack.getSettings();
  const capabilities = currentVideoTrack.getCapabilities?.() ?? {};
  const deviceMaxResolution =
    capabilities.width?.max && capabilities.height?.max
      ? `${capabilities.width.max} × ${capabilities.height.max}`
      : "unknown";

  const rows: [string, string][] = [
    ["Capture resolution", `${video.videoWidth} × ${video.videoHeight}`],
    ["Device max resolution", deviceMaxResolution],
    ["Frame rate", settings.frameRate ? `${settings.frameRate.toFixed(1)} fps` : "unknown"],
    ["Facing mode", settings.facingMode ?? "unknown"],
    ["Detection processing size", `${processingCanvas.width} × ${processingCanvas.height}`],
    ["Live FPS", fps ? fps.toFixed(0) : "—"],
    ["Detection cadence", `every ${DETECTION_FRAME_INTERVAL} frames`],
  ];

  appendResultRows(rows, "Live", liveResult);

  // Tracker diagnostics
  if (trackingResult) {
    const tr = trackingResult;
    rows.push(["Tracker state", tr.state]);
    rows.push(["Detection confidence", tr.detectionConfidence ? tr.detectionConfidence.toFixed(2) : "—"]);
    rows.push(["Tracking confidence", tr.trackingConfidence.toFixed(2)]);
    rows.push(["Stability score", tr.stabilityScore.toFixed(2)]);
    rows.push(["Corner velocity", tr.cornerVelocity ? `${tr.cornerVelocity.toFixed(1)} px/det` : "0"]);
  }

  appendResultRows(rows, "Capture", captureResult);

  if (lastFlattenedSize) {
    rows.push(["Last flattened size", `${lastFlattenedSize.width} × ${lastFlattenedSize.height}`]);
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
    rows.push(["  interior / total", `${c.interiorConsistency.toFixed(2)} / ${c.total.toFixed(2)}`]);
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
  const liveLayerDefs: { id: "rawDetected" | "velocity"; label: string }[] = [
    { id: "rawDetected", label: "Raw detected quad (live)" },
    { id: "velocity", label: "Corner velocity vectors (live)" },
  ];
  return liveLayerDefs.map(({ id, label }) => {
    const wrapper = document.createElement("label");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = liveOverlayLayers.has(id);
    input.addEventListener("change", () => {
      if (input.checked) liveOverlayLayers.add(id);
      else liveOverlayLayers.delete(id);
    });
    const span = document.createElement("span");
    span.textContent = label;
    wrapper.append(input, span);
    return wrapper;
  });
}

modeWebcamBtn.addEventListener("click", () => setMode("webcam"));
modeUploadBtn.addEventListener("click", () => setMode("upload"));
captureBtn.addEventListener("click", captureAndFlatten);
fileInput.addEventListener("change", () => void handleFileSelected());

async function init(): Promise<void> {
  cv = await loadOpenCv();
  statusEl.textContent = "OpenCV.js ready.";
  buildLayerToggles();
  setMode("webcam");
}

void init();
