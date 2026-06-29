import "./style.css";
import { loadOpenCv } from "./opencv";
import { drawQuadOutline, findDocumentQuad, warpDocument, type Quad } from "./documentScanner";
import type { CV, Mat as CvMat } from "@techstark/opencv-js";

const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const modeWebcamBtn = document.querySelector<HTMLButtonElement>("#mode-webcam")!;
const modeUploadBtn = document.querySelector<HTMLButtonElement>("#mode-upload")!;
const webcamPanel = document.querySelector<HTMLElement>("#webcam-panel")!;
const uploadPanel = document.querySelector<HTMLElement>("#upload-panel")!;
const resultPanel = document.querySelector<HTMLElement>("#result-panel")!;
const video = document.querySelector<HTMLVideoElement>("#video")!;
const overlayCanvas = document.querySelector<HTMLCanvasElement>("#overlay-canvas")!;
const captureBtn = document.querySelector<HTMLButtonElement>("#capture-btn")!;
const fileInput = document.querySelector<HTMLInputElement>("#file-input")!;
const uploadCanvas = document.querySelector<HTMLCanvasElement>("#upload-canvas")!;
const resultCanvas = document.querySelector<HTMLCanvasElement>("#result-canvas")!;
const downloadLink = document.querySelector<HTMLAnchorElement>("#download-link")!;
const debugListEl = document.querySelector<HTMLDListElement>("#debug-list")!;

const overlayCtx = overlayCanvas.getContext("2d")!;
const uploadCtx = uploadCanvas.getContext("2d")!;

// Detection runs on a downscaled offscreen frame for performance; the resulting
// quad is then rescaled back up to the overlay/full-res coordinate space.
const PROCESSING_WIDTH = 480;
const processingCanvas = document.createElement("canvas");
const processingCtx = processingCanvas.getContext("2d")!;

let cv: CV;
let mediaStream: MediaStream | null = null;
let detectionLoopHandle: number | null = null;
let lastWebcamQuad: Quad | null = null;
let currentVideoTrack: MediaStreamTrack | null = null;
let lastFlattenedSize: { width: number; height: number } | null = null;

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

// Requested as an "ideal" floor; maximizeTrackResolution() below pushes the
// actual negotiated resolution up to the device's true max afterward, since
// browsers may otherwise settle for a lower default even when a high "ideal"
// is given.
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
  // The user may have switched back to Upload mode while the permission
  // prompt / camera was still starting up — bail out without touching state.
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
  const scale = PROCESSING_WIDTH / video.videoWidth;
  processingCanvas.width = PROCESSING_WIDTH;
  processingCanvas.height = Math.round(video.videoHeight * scale);

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
    await track.applyConstraints({
      width: { ideal: maxWidth },
      height: { ideal: maxHeight },
    });
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
  captureBtn.disabled = true;
  debugListEl.replaceChildren();
}

/** Renders camera/capture diagnostics (negotiated resolution, frame rate, etc.) into the debug panel. */
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
    ["Device label", currentVideoTrack.label || "unknown"],
    ["Detection processing size", `${processingCanvas.width} × ${processingCanvas.height}`],
    ["Device pixel ratio", String(window.devicePixelRatio)],
  ];
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

function runDetectionLoop(): void {
  const scaleX = overlayCanvas.width / processingCanvas.width;
  const scaleY = overlayCanvas.height / processingCanvas.height;

  const tick = () => {
    processingCtx.drawImage(video, 0, 0, processingCanvas.width, processingCanvas.height);
    const src = cv.imread(processingCanvas);
    try {
      const quad = findDocumentQuad(cv, src);
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      if (quad) {
        lastWebcamQuad = quad.map((p) => ({ x: p.x * scaleX, y: p.y * scaleY })) as Quad;
        drawQuadOutline(overlayCtx, lastWebcamQuad);
        statusEl.textContent = "Document detected — ready to capture.";
      } else {
        lastWebcamQuad = null;
        statusEl.textContent = "Looking for a document… hold it flat within the frame.";
      }
    } finally {
      src.delete();
    }
    detectionLoopHandle = requestAnimationFrame(tick);
  };
  detectionLoopHandle = requestAnimationFrame(tick);
}

function captureAndFlatten(): void {
  const fullCanvas = document.createElement("canvas");
  fullCanvas.width = video.videoWidth;
  fullCanvas.height = video.videoHeight;
  fullCanvas.getContext("2d")!.drawImage(video, 0, 0);

  const src = cv.imread(fullCanvas);
  try {
    const quad = findDocumentQuad(cv, src) ?? lastWebcamQuad;
    if (!quad) {
      statusEl.textContent = "No document edges found — try repositioning and capture again.";
      return;
    }
    showWarpedResult(src, quad);
    renderDebugInfo();
  } finally {
    src.delete();
  }
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
    const quad = findDocumentQuad(cv, src);
    if (!quad) {
      statusEl.textContent = "No document edges found in this image.";
      resultPanel.classList.add("hidden");
      return;
    }
    drawQuadOutline(uploadCtx, quad);
    statusEl.textContent = "Document detected.";
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

modeWebcamBtn.addEventListener("click", () => setMode("webcam"));
modeUploadBtn.addEventListener("click", () => setMode("upload"));
captureBtn.addEventListener("click", captureAndFlatten);
fileInput.addEventListener("change", () => void handleFileSelected());

async function init(): Promise<void> {
  cv = await loadOpenCv();
  statusEl.textContent = "OpenCV.js ready.";
  setMode("webcam");
}

void init();
