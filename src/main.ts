import "./style.css";
import { drawQuadOutline, type Quad } from "./documentScanner";
import { warpRgba } from "./warp/webglWarp";
import { scaleWorkerResult } from "./detection/fuseDetection";
import { scaleQuad } from "./detection/geometry";
import { capturePreviewRgba, CAPTURE_DETECT_MAX_DIM, PREVIEW_DETECT_MAX_DIM } from "./detection/previewFrame";
import type { DetectionResult } from "./detection/types";
import { ParallelDetectionClient } from "./detection/worker/ParallelDetectionClient";
import type { WorkerDetectionResult } from "./detection/worker/types";
import { DocumentTracker, type TrackerOptions, type TrackingResult } from "./detection/tracker";
import { analyzeQualityRgba } from "./quality/rgba/analyzeQualityRgba";
import { precaptureGuidance } from "./quality/rgba/precaptureGuidance";
import type { DocumentQualityResult } from "./quality/types";
import { CornerEditor } from "./ui/cornerEditor";
import { enhanceAutoContrast } from "./enhance/autoContrast";

const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const uploadStatusEl = document.querySelector<HTMLParagraphElement>("#upload-status")!;
const video = document.querySelector<HTMLVideoElement>("#video")!;
const overlayCanvas = document.querySelector<HTMLCanvasElement>("#overlay-canvas")!;
const captureBtn = document.querySelector<HTMLButtonElement>("#capture-btn")!;
const galleryBtn = document.querySelector<HTMLButtonElement>("#gallery-btn")!;
const cameraPermissionEl = document.querySelector<HTMLElement>("#camera-permission")!;
const cameraPermissionTextEl = document.querySelector<HTMLParagraphElement>("#camera-permission-text")!;
const cameraPermitBtn = document.querySelector<HTMLButtonElement>("#camera-permit-btn")!;
const cameraPermissionGalleryBtn = document.querySelector<HTMLButtonElement>("#camera-permission-gallery-btn")!;
const fileInput = document.querySelector<HTMLInputElement>("#file-input")!;
const uploadCanvas = document.querySelector<HTMLCanvasElement>("#upload-canvas")!;
const resultCanvas = document.querySelector<HTMLCanvasElement>("#result-canvas")!;
const downloadLink = document.querySelector<HTMLAnchorElement>("#download-link")!;
const debugListEl = document.querySelector<HTMLDListElement>("#debug-list")!;
const debugLayersEl = document.querySelector<HTMLDivElement>("#debug-layers")!;
const debugModal = document.querySelector<HTMLDialogElement>("#debug-modal")!;
const debugOpenBtn = document.querySelector<HTMLButtonElement>("#debug-open-btn")!;
const debugCloseBtn = document.querySelector<HTMLButtonElement>("#debug-close-btn")!;
const editorModal = document.querySelector<HTMLDialogElement>("#editor-modal")!;
const editorBodyEl = document.querySelector<HTMLElement>("#editor-body")!;
const editorCanvas = document.querySelector<HTMLCanvasElement>("#editor-canvas")!;
const flattenBtn = document.querySelector<HTMLButtonElement>("#flatten-btn")!;
const editorBackBtn = document.querySelector<HTMLButtonElement>("#editor-back")!;
const resultModal = document.querySelector<HTMLDialogElement>("#result-modal")!;
const resultDoneBtn = document.querySelector<HTMLButtonElement>("#result-done-btn")!;
const resultDoneBtnFooter = document.querySelector<HTMLButtonElement>("#result-done-btn-footer")!;
const precaptureHintsEl = document.querySelector<HTMLDivElement>("#precapture-hints")!;
const qualityGradeEl = document.querySelector<HTMLSpanElement>("#quality-grade")!;
const qualityRecsEl = document.querySelector<HTMLUListElement>("#quality-recommendations")!;
const enhanceToggle = document.querySelector<HTMLInputElement>("#enhance-toggle")!;

const overlayCtx = overlayCanvas.getContext("2d")!;
const uploadCtx = uploadCanvas.getContext("2d")!;

const LIVE_DETECT_TICKS_BETWEEN_ML = 8;
const LIVE_DETECT_TICKS_FALLBACK = 3;
const SOFT_CAPTURE_MIN_TRACKING_CONFIDENCE = 0.35;
const SOFT_CAPTURE_MIN_DETECTION_CONFIDENCE = 0.45;
const EXPORT_MIN_DOCUMENT_WIDTH = 2400;
const UPLOAD_PREVIEW_MAX_WIDTH = 720;
const liveDetectCanvas = document.createElement("canvas");
const liveDetectCtx = liveDetectCanvas.getContext("2d")!;

function isMobileLikeDevice(): boolean {
  return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
}

/** Expected animation frames between ML results — used for tracker confidence decay. */
function expectedTicksBetweenMlResults(): number {
  return detectionWorker?.isMlAvailable ? LIVE_DETECT_TICKS_BETWEEN_ML : LIVE_DETECT_TICKS_FALLBACK;
}

/** Tracker tuning — mobile gets faster capture-ready with more handheld motion tolerance. */
function createTrackerOptions(): TrackerOptions {
  const ticksBetweenDetections = expectedTicksBetweenMlResults();
  if (!isMobileLikeDevice()) {
    return { ticksBetweenDetections };
  }
  return {
    ticksBetweenDetections,
    framesForTracking: 1,
    captureReadyStability: 0.4,
    stabilityBlend: 0.22,
    velocityStabilityScale: 32,
    trackingEntryStability: 0.35,
    alphaAtLowMotion: 0.78,
    alphaAtHighMotion: 0.35,
    alphaWhenStable: 0.94,
    alphaOnLargeChange: 0.12,
    motionThreshold: 35,
    stableMotionThresholdScale: 1.8,
    largeChangeMotionThreshold: 55,
    largeChangeStabilityPenalty: 0.5,
  };
}

let captureReadyStability = 0.75;

/** Full-resolution (or high-res) detection for capture/upload — refines corners after a quick live lock. */
async function detectAtCaptureResolution(
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
): Promise<WorkerDetectionResult> {
  const frame = capturePreviewRgba(
    liveDetectCtx,
    liveDetectCanvas,
    source,
    srcWidth,
    srcHeight,
    CAPTURE_DETECT_MAX_DIM,
  );
  const result = await detectionWorker.detectPreview(
    frame.width,
    frame.height,
    frame.data,
    frame.data.buffer,
  );
  return scaleWorkerResult(result, frame.toSourceScale, frame.toSourceScale);
}

/** Live preview is lenient; capture is allowed once a document is roughly locked. */
function canUseShutter(): boolean {
  if (!lastWebcamQuad || !trackingResult?.quad) return false;
  if (tracker?.isCaptureReady()) return true;
  const tr = trackingResult;
  if (tr.state === "tracking" && tr.trackingConfidence >= SOFT_CAPTURE_MIN_TRACKING_CONFIDENCE) return true;
  if (tr.state === "detected" && tr.detectionConfidence >= SOFT_CAPTURE_MIN_DETECTION_CONFIDENCE) return true;
  return false;
}

let detectionWorker: ParallelDetectionClient;
let mediaStream: MediaStream | null = null;
let detectionLoopHandle: number | null = null;
let lastWebcamQuad: Quad | null = null;
let currentVideoTrack: MediaStreamTrack | null = null;
let lastFlattenedSize: { width: number; height: number } | null = null;

let liveResult: DetectionResult | null = null;
let captureResult: DetectionResult | null = null;
let captureSrcWidth = 0;
let captureSrcHeight = 0;

let editor: CornerEditor | null = null;
let editorStill: { canvas: HTMLCanvasElement; width: number; height: number } | null = null;
let lastWarpRaw: { data: Uint8ClampedArray; width: number; height: number } | null = null;
let lastQuality: DocumentQualityResult | null = null;
let fps = 0;
let lastTickTime = 0;
let frameCounter = 0;
let detectionCycleCounter = 0;
let liveLoopGeneration = 0;

let tracker: DocumentTracker | null = null;
let trackingResult: TrackingResult | null = null;
let lastPrecaptureHintsKey = "";

const liveOverlayLayers = new Set<"rawDetected" | "velocity">(["rawDetected"]);

type Mode = "webcam" | "upload";
let activeMode: Mode = "webcam";

interface CoverTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

function openModal(dialog: HTMLDialogElement): void {
  if (!dialog.open) dialog.showModal();
}

function closeModal(dialog: HTMLDialogElement): void {
  if (dialog.open) dialog.close();
}

function setStatus(message: string): void {
  if (activeMode === "upload") {
    uploadStatusEl.textContent = message;
  }
  statusEl.textContent = message;
}

function videoCoverTransform(el: HTMLVideoElement): CoverTransform {
  const scale = Math.max(el.clientWidth / el.videoWidth, el.clientHeight / el.videoHeight);
  const displayW = el.videoWidth * scale;
  const displayH = el.videoHeight * scale;
  return {
    scale,
    offsetX: (el.clientWidth - displayW) / 2,
    offsetY: (el.clientHeight - displayH) / 2,
  };
}

/** Sync overlay canvas to display pixels; returns cover transform for mapping source quads. */
function syncOverlaySize(): CoverTransform | null {
  if (!video.videoWidth || !video.clientWidth) return null;
  const cw = video.clientWidth;
  const ch = video.clientHeight;
  if (overlayCanvas.width !== cw || overlayCanvas.height !== ch) {
    overlayCanvas.width = cw;
    overlayCanvas.height = ch;
  }
  return videoCoverTransform(video);
}

function mapQuadToDisplay(quad: Quad, t: CoverTransform): Quad {
  return quad.map((p) => ({
    x: p.x * t.scale + t.offsetX,
    y: p.y * t.scale + t.offsetY,
  })) as Quad;
}

function cameraPrerequisiteMessage(): string | null {
  if (!window.isSecureContext) {
    return "Camera requires HTTPS. On iPhone, open the https:// address from the dev server (not http://), accept the certificate warning, then tap Allow camera.";
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return "Camera is not available in this browser. Use Safari, or choose from gallery.";
  }
  return null;
}

/** Progressive constraint fallbacks — iOS Safari often rejects strict facingMode + resolution combos. */
async function requestCameraStream(): Promise<MediaStream> {
  const prerequisite = cameraPrerequisiteMessage();
  if (prerequisite) throw new Error(prerequisite);

  const attempts: MediaStreamConstraints[] = [
    {
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
      audio: false,
    },
    { video: { facingMode: { ideal: "environment" } }, audio: false },
    { video: { facingMode: "environment" }, audio: false },
    { video: true, audio: false },
  ];

  let lastError: unknown;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      lastError = err;
      if (
        err instanceof DOMException &&
        (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")
      ) {
        throw err;
      }
    }
  }
  throw lastError ?? new Error("Camera unavailable");
}

function cameraErrorMessage(err: unknown): { card: string; status: string } {
  const prerequisite = cameraPrerequisiteMessage();
  if (prerequisite) {
    return { card: prerequisite, status: "Camera needs HTTPS." };
  }
  if (err instanceof Error && !(err instanceof DOMException)) {
    return { card: err.message, status: "Could not access the camera." };
  }
  if (err instanceof DOMException) {
    switch (err.name) {
      case "NotAllowedError":
      case "PermissionDeniedError":
        return {
          card: "Camera access was denied. In Settings → Safari → Camera, allow access for this site, then tap Allow camera again.",
          status: "Camera permission denied.",
        };
      case "NotFoundError":
        return {
          card: "No camera found on this device. Choose from gallery instead.",
          status: "No camera found.",
        };
      case "NotReadableError":
        return {
          card: "Camera is in use by another app. Close it and try again.",
          status: "Camera is busy.",
        };
      case "SecurityError":
        return {
          card: "Camera blocked — use the https:// URL (not http://) and accept the security certificate on your iPhone.",
          status: "Camera blocked (insecure page).",
        };
      case "OverconstrainedError":
        return {
          card: "Could not open the camera with the requested settings. Try again or choose from gallery.",
          status: "Camera constraints not supported.",
        };
      default:
        return {
          card: `Could not access the camera (${err.name}). Try again or choose from gallery.`,
          status: "Could not access the camera.",
        };
    }
  }
  return {
    card: "Could not access the camera. Try again or choose from gallery.",
    status: "Could not access the camera.",
  };
}

function showCameraPermission(message?: string): void {
  cameraPermissionEl.classList.remove("hidden");
  cameraPermissionTextEl.textContent =
    message ?? "Allow camera access to scan documents live.";
}

function hideCameraPermission(): void {
  cameraPermissionEl.classList.add("hidden");
}

const CAMERA_CONSENT_KEY = "scanner.cameraConsent.v1";

function hasStoredCameraConsent(): boolean {
  try {
    return localStorage.getItem(CAMERA_CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

function storeCameraConsent(): void {
  try {
    localStorage.setItem(CAMERA_CONSENT_KEY, "1");
  } catch {
    // private browsing / storage blocked
  }
}

function clearStoredCameraConsent(): void {
  try {
    localStorage.removeItem(CAMERA_CONSENT_KEY);
  } catch {
    // ignore
  }
}

/** Returns granted / denied / prompt, or null if the Permissions API is unavailable. */
async function queryCameraPermission(): Promise<PermissionState | null> {
  try {
    if (!navigator.permissions?.query) return null;
    const status = await navigator.permissions.query({ name: "camera" as PermissionName });
    status.onchange = () => {
      if (status.state === "granted") storeCameraConsent();
      if (status.state === "denied") clearStoredCameraConsent();
    };
    return status.state;
  } catch {
    return null;
  }
}

async function maybeAutoStartCamera(): Promise<void> {
  const prerequisite = cameraPrerequisiteMessage();
  if (prerequisite) {
    showCameraPermission(prerequisite);
    return;
  }

  const permission = await queryCameraPermission();
  const remembered = hasStoredCameraConsent();

  if (permission === "denied") {
    clearStoredCameraConsent();
    const { card, status } = cameraErrorMessage(new DOMException("denied", "NotAllowedError"));
    showCameraPermission(card);
    setStatus(status);
    return;
  }
  if (permission === "granted" || remembered) {
    const started = await startWebcam({ silent: true });
    if (started) return;
    if (remembered) clearStoredCameraConsent();
    showCameraPermission();
    return;
  }
  if (permission === "prompt") {
    showCameraPermission();
    return;
  }

  // Permissions API unavailable — try starting silently when the browser already granted access.
  const started = await startWebcam({ silent: true });
  if (!started) showCameraPermission();
}

function openGalleryPicker(): void {
  hideCameraPermission();
  fileInput.value = "";
  fileInput.click();
}

async function startWebcam(opts?: { silent?: boolean }): Promise<boolean> {
  if (mediaStream) return true;
  let stream: MediaStream;
  try {
    stream = await requestCameraStream();
  } catch (err) {
    if (
      err instanceof DOMException &&
      (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")
    ) {
      clearStoredCameraConsent();
    }
    if (!opts?.silent) {
      const { card, status } = cameraErrorMessage(err);
      showCameraPermission(card);
      setStatus(status);
    }
    return false;
  }
  if (activeMode !== "webcam") {
    stream.getTracks().forEach((track) => track.stop());
    return false;
  }
  mediaStream = stream;
  const [track] = stream.getVideoTracks();
  currentVideoTrack = track;
  await maximizeTrackResolution(track);

  video.srcObject = mediaStream;
  await video.play();

  if (activeMode !== "webcam") {
    stopWebcam();
    return false;
  }

  syncOverlaySize();
  const trackerOpts = createTrackerOptions();
  captureReadyStability = trackerOpts.captureReadyStability ?? 0.75;
  tracker = new DocumentTracker(trackerOpts);

  hideCameraPermission();
  storeCameraConsent();
  captureBtn.disabled = true;
  setStatus("Looking for a document… hold it flat within the frame.");
  renderDebugInfo();
  runDetectionLoop();
  return true;
}

async function maximizeTrackResolution(track: MediaStreamTrack): Promise<void> {
  const capabilities = track.getCapabilities?.();
  const maxWidth = capabilities?.width?.max;
  const maxHeight = capabilities?.height?.max;
  if (!maxWidth || !maxHeight) return;
  try {
    await track.applyConstraints({ width: { ideal: maxWidth }, height: { ideal: maxHeight } });
  } catch {
    // keep negotiated resolution
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
  lastPrecaptureHintsKey = "";
  captureBtn.disabled = true;
  precaptureHintsEl.replaceChildren();
  debugListEl.replaceChildren();
}

function pauseLiveLoop(): void {
  liveLoopGeneration++;
  detectionWorker.cancelLiveFrames();
  if (detectionLoopHandle !== null) {
    cancelAnimationFrame(detectionLoopHandle);
    detectionLoopHandle = null;
  }
  precaptureHintsEl.replaceChildren();
}

function resumeLiveLoop(): void {
  if (activeMode === "webcam" && mediaStream && detectionLoopHandle === null && tracker) {
    runDetectionLoop();
  }
}

function renderPrecaptureHints(quad: Quad | null): void {
  if (!quad) {
    if (lastPrecaptureHintsKey !== "") {
      lastPrecaptureHintsKey = "";
      precaptureHintsEl.replaceChildren();
    }
    return;
  }
  const { hints } = precaptureGuidance(
    quad,
    undefined,
    video.videoWidth > 0 ? { width: video.videoWidth, height: video.videoHeight } : undefined,
  );
  const hintsKey = hints.join("\0");
  if (hintsKey === lastPrecaptureHintsKey) return;
  lastPrecaptureHintsKey = hintsKey;
  precaptureHintsEl.replaceChildren(
    ...hints.map((text) => {
      const chip = document.createElement("span");
      chip.className = "hint-chip";
      chip.textContent = text;
      return chip;
    }),
  );
}

function runDetectionLoop(): void {
  frameCounter = 0;
  detectionCycleCounter = 0;
  const loopGeneration = ++liveLoopGeneration;

  const tick = () => {
    if (loopGeneration !== liveLoopGeneration || activeMode !== "webcam" || !tracker) return;

    const now = performance.now();
    if (lastTickTime) fps = fps * 0.8 + (1000 / Math.max(1, now - lastTickTime)) * 0.2;
    lastTickTime = now;

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw > 0 && vh > 0) {
      detectionCycleCounter++;
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
    }

    if (detectionWorker.isLiveBusy && tracker) {
      trackingResult = tracker.tick();
    }

    renderPrecaptureHints(trackingResult?.quad ?? null);
    renderLiveOverlay();
    frameCounter++;
    detectionLoopHandle = requestAnimationFrame(tick);
  };
  detectionLoopHandle = requestAnimationFrame(tick);
}

function renderUploadPreview(image: HTMLImageElement, previewScale: number, result: DetectionResult | null): void {
  uploadCanvas.width = Math.round(image.width * previewScale);
  uploadCanvas.height = Math.round(image.height * previewScale);
  uploadCtx.drawImage(image, 0, 0, uploadCanvas.width, uploadCanvas.height);
  if (!result) return;
  if (liveOverlayLayers.has("rawDetected") && result.quad) {
    drawQuadOutline(uploadCtx, scaleQuad(result.quad, previewScale, previewScale), {
      stroke: "rgba(255,200,0,0.9)",
      lineWidth: 2.5,
      cornerRadius: 5,
    });
  }
}

function renderLiveOverlay(): void {
  const t = syncOverlaySize();
  if (!t) return;

  overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!trackingResult) return;

  const tr = trackingResult;

  if (liveOverlayLayers.has("rawDetected") && tr.rawDetectedQuad) {
    drawQuadOutline(overlayCtx, mapQuadToDisplay(tr.rawDetectedQuad, t), {
      stroke: "rgba(255,200,0,0.65)",
      lineWidth: 1.5,
    });
  }

  if (tr.quad) {
    lastWebcamQuad = tr.quad;
    const displayQuad = mapQuadToDisplay(tr.quad, t);

    const stateColor =
      tr.state === "tracking"
        ? tr.stabilityScore >= captureReadyStability
          ? "#22c55e"
          : "#4ade80"
        : tr.state === "detected"
          ? "#facc15"
          : "rgba(148,163,184,0.7)";

    drawQuadOutline(overlayCtx, displayQuad, { stroke: stateColor, lineWidth: tr.state === "tracking" ? 3 : 2 });

    if (liveOverlayLayers.has("velocity") && tr.cornerDeltas) {
      drawVelocityArrows(overlayCtx, displayQuad, tr.cornerDeltas, t.scale);
    }
  }

  updateStatusText(tr);
  const ready = tracker?.isCaptureReady() ?? false;
  const shutterEnabled = canUseShutter();
  captureBtn.disabled = !shutterEnabled;
  captureBtn.classList.toggle("hold-steady", !shutterEnabled);
  captureBtn.classList.toggle("capture-soft", shutterEnabled && !ready);
  captureBtn.setAttribute(
    "aria-label",
    ready ? "Capture document" : shutterEnabled ? "Capture document" : "Hold steady",
  );
}

function drawVelocityArrows(
  ctx: CanvasRenderingContext2D,
  displayQuad: Quad,
  deltas: TrackingResult["cornerDeltas"],
  displayScale: number,
): void {
  if (!deltas) return;
  const AMP = 8;

  ctx.save();
  ctx.strokeStyle = "rgba(255,100,100,0.85)";
  ctx.fillStyle = "rgba(255,100,100,0.85)";
  ctx.lineWidth = 1.5;

  for (let i = 0; i < 4; i++) {
    const cx = displayQuad[i].x;
    const cy = displayQuad[i].y;
    const dx = deltas[i].x * displayScale * AMP;
    const dy = deltas[i].y * displayScale * AMP;
    const len = Math.hypot(dx, dy);
    if (len < 1) continue;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + dx, cy + dy);
    ctx.stroke();

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
      setStatus(
        tr.detectionConfidence >= SOFT_CAPTURE_MIN_DETECTION_CONFIDENCE
          ? "Document detected — tap to capture."
          : "Document detected — aligning…",
      );
      break;
    case "tracking":
      if (tr.stabilityScore >= captureReadyStability) {
        setStatus("Document locked — ready to capture.");
      } else if (tr.trackingConfidence >= SOFT_CAPTURE_MIN_TRACKING_CONFIDENCE) {
        setStatus("Document tracked — tap to capture.");
      } else {
        setStatus("Document tracked — stabilising… hold still.");
      }
      break;
    case "lost":
      setStatus("Document lost — searching…");
      break;
  }
}

async function captureAndFlatten(): Promise<void> {
  if (!canUseShutter()) {
    setStatus("Point the camera at a document within the frame.");
    return;
  }

  const fallbackQuad = lastWebcamQuad!;
  captureBtn.disabled = true;
  setStatus("Capturing…");

  try {
    const still = freezeFrame(video, video.videoWidth, video.videoHeight);
    captureSrcWidth = still.width;
    captureSrcHeight = still.height;

    setStatus("Refining corners…");
    captureResult = await detectAtCaptureResolution(still, captureSrcWidth, captureSrcHeight);
    const quad = captureResult.quad ?? fallbackQuad;
    if (!quad) {
      setStatus("No document edges found — try repositioning and capture again.");
      return;
    }
    openEditor(still, captureSrcWidth, captureSrcHeight, quad);
    renderDebugInfo();
  } catch {
    setStatus("Detection failed — try again.");
  } finally {
    captureBtn.disabled = !canUseShutter();
  }
}

function freezeFrame(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d")!.drawImage(source, 0, 0, width, height);
  return canvas;
}

function createCornerEditor(still: HTMLCanvasElement, width: number, height: number, quad: Quad): void {
  const pad = 16;
  const maxW = Math.max(1, editorBodyEl.clientWidth - pad);
  const maxH = Math.max(1, editorBodyEl.clientHeight - pad);
  editor?.destroy();
  editor = new CornerEditor({
    canvas: editorCanvas,
    source: still,
    sourceWidth: width,
    sourceHeight: height,
    quad,
    maxDisplayWidth: maxW,
    maxDisplayHeight: maxH,
  });
}

function openEditor(still: HTMLCanvasElement, width: number, height: number, quad: Quad): void {
  editorStill = { canvas: still, width, height };
  if (activeMode === "webcam") pauseLiveLoop();

  openModal(editorModal);
  requestAnimationFrame(() => {
    createCornerEditor(still, width, height, quad);
  });
}

function closeEditor(): void {
  editor?.destroy();
  editor = null;
  editorStill = null;
  closeModal(editorModal);
  activeMode = "webcam";
  if (mediaStream) resumeLiveLoop();
  else void maybeAutoStartCamera();
}

function flattenFromEditor(): void {
  if (!editor || !editorStill) return;
  const quad = editor.getQuad();
  const { canvas, width, height } = editorStill;
  const srcData = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;

  const nativeWarp = warpRgba(srcData, width, height, quad, {});
  const exportWarp = warpRgba(srcData, width, height, quad, { minOutputWidth: EXPORT_MIN_DOCUMENT_WIDTH });

  lastWarpRaw = exportWarp;
  lastQuality = analyzeQualityRgba(nativeWarp.data, nativeWarp.width, nativeWarp.height, quad);

  editor.destroy();
  editor = null;
  editorStill = null;
  closeModal(editorModal);
  activeMode = "webcam";
  renderResult();
}

function renderResult(): void {
  if (!lastWarpRaw) return;
  const { data, width, height } = lastWarpRaw;
  const finalData = enhanceToggle.checked ? enhanceAutoContrast(data, width, height) : data;
  showWarpedResult(finalData, width, height);
  renderQuality(lastQuality);
  renderDebugInfo();
}

function renderQuality(quality: DocumentQualityResult | null): void {
  if (!quality) {
    qualityGradeEl.textContent = "";
    qualityGradeEl.className = "quality-grade";
    qualityRecsEl.replaceChildren();
    return;
  }
  qualityGradeEl.textContent = `${quality.qualityGrade.toUpperCase()} · ${quality.overallScore}/100`;
  qualityGradeEl.className = `quality-grade grade-${quality.qualityGrade}`;
  const items = quality.recommendations.length ? quality.recommendations : ["Looks good — no issues detected."];
  qualityRecsEl.replaceChildren(
    ...items.map((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      return li;
    }),
  );
}

function showWarpedResult(data: Uint8ClampedArray, width: number, height: number): void {
  resultCanvas.width = width;
  resultCanvas.height = height;
  resultCanvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
  downloadLink.href = resultCanvas.toDataURL("image/png");
  downloadLink.download = `scanned-document-${width}x${height}.png`;
  lastFlattenedSize = { width, height };
  openModal(resultModal);
}

function closeResultModal(): void {
  closeModal(resultModal);
  if (mediaStream) resumeLiveLoop();
  else void maybeAutoStartCamera();
}

async function handleFileSelected(): Promise<void> {
  const file = fileInput.files?.[0];
  if (!file) return;

  activeMode = "upload";
  const image = await loadImageFile(file);
  const previewScale = Math.min(1, UPLOAD_PREVIEW_MAX_WIDTH / image.width);

  setStatus("Detecting document…");
  renderUploadPreview(image, previewScale, null);

  try {
    captureResult = await detectAtCaptureResolution(image, image.width, image.height);
    captureSrcWidth = image.width;
    captureSrcHeight = image.height;
    renderUploadPreview(image, previewScale, captureResult);
    renderDebugInfo();

    const quad = captureResult.quad;
    if (!quad) {
      setStatus("No document edges found — try another image.");
      activeMode = "webcam";
      return;
    }
    const conf = captureResult.confidence ? ` (confidence ${captureResult.confidence.value.toFixed(2)})` : "";
    setStatus(`Document detected${conf}.`);
    const still = freezeFrame(image, image.width, image.height);
    openEditor(still, image.width, image.height, quad);
  } catch {
    setStatus("Detection failed for this image.");
    activeMode = "webcam";
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
      ["Detection cadence", detectionWorker.isMlAvailable ? "every frame (ML)" : "ML unavailable"],
      ["Detection thread", "web worker"],
      ["Worker status", detectionWorker.isLiveBusy ? "busy" : "idle"],
    );

    appendResultRows(rows, "Live", liveResult);

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
    appendResultRows(rows, "Upload", captureResult);
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

function appendResultRows(rows: [string, string][], label: string, result: DetectionResult | null): void {
  if (!result) return;
  rows.push([`${label} detect time`, `${sumTimings(result)} ms`]);
  rows.push([`${label} confidence`, result.confidence ? result.confidence.value.toFixed(2) : "—"]);
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

function buildLayerToggles(): void {
  debugLayersEl.replaceChildren(...buildLiveLayerToggles());
}

function buildLiveLayerToggles(): HTMLLabelElement[] {
  const liveLayerDefs: { id: "rawDetected" | "velocity"; label: string }[] = [
    { id: "rawDetected", label: "Raw detected quad (yellow)" },
    { id: "velocity", label: "Corner velocity vectors" },
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

captureBtn.addEventListener("click", () => void captureAndFlatten());
cameraPermitBtn.addEventListener("click", () => void startWebcam());
cameraPermissionGalleryBtn.addEventListener("click", () => openGalleryPicker());
galleryBtn.addEventListener("click", () => openGalleryPicker());
fileInput.addEventListener("change", () => void handleFileSelected());
flattenBtn.addEventListener("click", () => flattenFromEditor());
editorBackBtn.addEventListener("click", () => closeEditor());
enhanceToggle.addEventListener("change", () => renderResult());
debugOpenBtn.addEventListener("click", () => {
  renderDebugInfo();
  openModal(debugModal);
});
debugCloseBtn.addEventListener("click", () => closeModal(debugModal));
resultDoneBtn.addEventListener("click", () => closeResultModal());
resultDoneBtnFooter.addEventListener("click", () => closeResultModal());

window.addEventListener("resize", () => syncOverlaySize());
window.addEventListener("orientationchange", () => {
  requestAnimationFrame(() => syncOverlaySize());
});

async function init(): Promise<void> {
  setStatus("Loading detector…");
  detectionWorker = new ParallelDetectionClient();
  await detectionWorker.whenReady();
  const httpsHint = window.isSecureContext ? "" : " Use the https:// link on your phone.";
  setStatus(
    detectionWorker.isMlAvailable
      ? `Tap Allow camera to start scanning.${httpsHint}`
      : `ML detector unavailable — you can still choose from gallery.${httpsHint}`,
  );
  buildLayerToggles();
  await maybeAutoStartCamera();
}

void init();
