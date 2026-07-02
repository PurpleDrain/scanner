import { ref, reactive, onMounted, onUnmounted } from "vue";
import type { Ref } from "vue";
import { drawQuadOutline, type Quad } from "../documentScanner";
import { capturePreviewRgba } from "../detection/previewFrame";
import type { DetectionResult } from "../detection/types";
import { DocumentTracker, type TrackerOptions, type TrackingResult } from "../detection/tracker";
import { scaleWorkerResult } from "../detection/fuseDetection";
import { precaptureGuidance } from "../quality/rgba/precaptureGuidance";
import type { ParallelDetectionClient } from "../detection/worker/ParallelDetectionClient";

type Mode = "webcam" | "upload";
export type CaptureMode = "ready" | "soft" | "hold";

const LIVE_DETECT_TICKS_BETWEEN_ML = 8;
const LIVE_DETECT_TICKS_FALLBACK = 3;
const SOFT_CAPTURE_MIN_TRACKING_CONFIDENCE = 0.35;
const SOFT_CAPTURE_MIN_DETECTION_CONFIDENCE = 0.45;
const CAMERA_CONSENT_KEY = "scanner.cameraConsent.v1";

interface CoverTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function useCameraSession(deps: {
  getWorker: () => ParallelDetectionClient;
  isMlAvailable: Ref<boolean>;
  activeMode: Ref<Mode>;
}) {
  const { getWorker, isMlAvailable, activeMode } = deps;

  let videoEl: HTMLVideoElement | null = null;
  let overlayEl: HTMLCanvasElement | null = null;
  let overlayCtx: CanvasRenderingContext2D | null = null;
  const liveDetectCanvas = document.createElement("canvas");
  const liveDetectCtx = liveDetectCanvas.getContext("2d")!;

  const status = ref("Loading detector…");
  const hints = ref<string[]>([]);
  const captureEnabled = ref(false);
  const captureMode = ref<CaptureMode>("hold");
  const showPermission = ref(false);
  const permissionMessage = ref("Allow camera access to scan documents live.");
  const liveOverlayLayers = reactive({ rawDetected: true, velocity: false });
  const mediaStream = ref<MediaStream | null>(null);
  const currentVideoTrack = ref<MediaStreamTrack | null>(null);

  let tracker: DocumentTracker | null = null;
  let trackingResult: TrackingResult | null = null;
  let liveResult: DetectionResult | null = null;
  let lastWebcamQuad: Quad | null = null;
  let lastPrecaptureHintsKey = "";
  let detectionLoopHandle: number | null = null;
  let liveLoopGeneration = 0;
  let fps = 0;
  let lastTickTime = 0;
  let captureReadyStability = 0.75;

  function setElements(video: HTMLVideoElement, overlay: HTMLCanvasElement) {
    videoEl = video;
    overlayEl = overlay;
    overlayCtx = overlay.getContext("2d")!;
  }

  function getLastWebcamQuad(): Quad | null { return lastWebcamQuad; }
  function getTrackingResult(): TrackingResult | null { return trackingResult; }
  function getLiveResult(): DetectionResult | null { return liveResult; }
  function getFps(): number { return fps; }

  function isMobileLikeDevice(): boolean {
    return window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  }

  function expectedTicksBetweenMlResults(): number {
    return isMlAvailable.value ? LIVE_DETECT_TICKS_BETWEEN_ML : LIVE_DETECT_TICKS_FALLBACK;
  }

  function createTrackerOptions(): TrackerOptions {
    const ticksBetweenDetections = expectedTicksBetweenMlResults();
    if (!isMobileLikeDevice()) return { ticksBetweenDetections };
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

  function canUseShutter(): boolean {
    if (!lastWebcamQuad || !trackingResult?.quad) return false;
    if (tracker?.isCaptureReady()) return true;
    const tr = trackingResult;
    if (tr.state === "tracking" && tr.trackingConfidence >= SOFT_CAPTURE_MIN_TRACKING_CONFIDENCE) return true;
    if (tr.state === "detected" && tr.detectionConfidence >= SOFT_CAPTURE_MIN_DETECTION_CONFIDENCE) return true;
    return false;
  }

  function hasStoredCameraConsent(): boolean {
    try { return localStorage.getItem(CAMERA_CONSENT_KEY) === "1"; } catch { return false; }
  }

  function storeCameraConsent(): void {
    try { localStorage.setItem(CAMERA_CONSENT_KEY, "1"); } catch {}
  }

  function clearStoredCameraConsent(): void {
    try { localStorage.removeItem(CAMERA_CONSENT_KEY); } catch {}
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

  function cameraErrorMessage(err: unknown): { card: string; status: string } {
    const prerequisite = cameraPrerequisiteMessage();
    if (prerequisite) return { card: prerequisite, status: "Camera needs HTTPS." };
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
          return { card: "No camera found on this device. Choose from gallery instead.", status: "No camera found." };
        case "NotReadableError":
          return { card: "Camera is in use by another app. Close it and try again.", status: "Camera is busy." };
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
    return { card: "Could not access the camera. Try again or choose from gallery.", status: "Could not access the camera." };
  }

  async function queryCameraPermission(): Promise<PermissionState | null> {
    try {
      if (!navigator.permissions?.query) return null;
      const st = await navigator.permissions.query({ name: "camera" as PermissionName });
      st.onchange = () => {
        if (st.state === "granted") storeCameraConsent();
        if (st.state === "denied") clearStoredCameraConsent();
      };
      return st.state;
    } catch { return null; }
  }

  async function requestCameraStream(): Promise<MediaStream> {
    const prerequisite = cameraPrerequisiteMessage();
    if (prerequisite) throw new Error(prerequisite);
    const attempts: MediaStreamConstraints[] = [
      { video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
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
        if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")) {
          throw err;
        }
      }
    }
    throw lastError ?? new Error("Camera unavailable");
  }

  async function maximizeTrackResolution(track: MediaStreamTrack): Promise<void> {
    const capabilities = track.getCapabilities?.();
    const maxWidth = capabilities?.width?.max;
    const maxHeight = capabilities?.height?.max;
    if (!maxWidth || !maxHeight) return;
    try { await track.applyConstraints({ width: { ideal: maxWidth }, height: { ideal: maxHeight } }); } catch {}
  }

  function videoCoverTransform(el: HTMLVideoElement): CoverTransform {
    const scale = Math.max(el.clientWidth / el.videoWidth, el.clientHeight / el.videoHeight);
    const displayW = el.videoWidth * scale;
    const displayH = el.videoHeight * scale;
    return { scale, offsetX: (el.clientWidth - displayW) / 2, offsetY: (el.clientHeight - displayH) / 2 };
  }

  function syncOverlaySize(): CoverTransform | null {
    if (!videoEl || !overlayEl || !videoEl.videoWidth || !videoEl.clientWidth) return null;
    const cw = videoEl.clientWidth;
    const ch = videoEl.clientHeight;
    if (overlayEl.width !== cw || overlayEl.height !== ch) {
      overlayEl.width = cw;
      overlayEl.height = ch;
    }
    return videoCoverTransform(videoEl);
  }

  function mapQuadToDisplay(quad: Quad, t: CoverTransform): Quad {
    return quad.map((p) => ({ x: p.x * t.scale + t.offsetX, y: p.y * t.scale + t.offsetY })) as Quad;
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
      const cx = displayQuad[i].x, cy = displayQuad[i].y;
      const dx = deltas[i].x * displayScale * AMP, dy = deltas[i].y * displayScale * AMP;
      const len = Math.hypot(dx, dy);
      if (len < 1) continue;
      ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + dx, cy + dy); ctx.stroke();
      const angle = Math.atan2(dy, dx);
      const headLen = Math.min(8, len * 0.4);
      ctx.beginPath();
      ctx.moveTo(cx + dx, cy + dy);
      ctx.lineTo(cx + dx - headLen * Math.cos(angle - 0.4), cy + dy - headLen * Math.sin(angle - 0.4));
      ctx.lineTo(cx + dx - headLen * Math.cos(angle + 0.4), cy + dy - headLen * Math.sin(angle + 0.4));
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }

  function updateStatusText(tr: TrackingResult): void {
    switch (tr.state) {
      case "searching":
        status.value = "Looking for a document… hold it flat within the frame.";
        break;
      case "detected":
        status.value = tr.detectionConfidence >= SOFT_CAPTURE_MIN_DETECTION_CONFIDENCE
          ? "Document detected — tap to capture."
          : "Document detected — aligning…";
        break;
      case "tracking":
        if (tr.stabilityScore >= captureReadyStability) {
          status.value = "Document locked — ready to capture.";
        } else if (tr.trackingConfidence >= SOFT_CAPTURE_MIN_TRACKING_CONFIDENCE) {
          status.value = "Document tracked — tap to capture.";
        } else {
          status.value = "Document tracked — stabilising… hold still.";
        }
        break;
      case "lost":
        status.value = "Document lost — searching…";
        break;
    }
  }

  function renderLiveOverlay(): void {
    const t = syncOverlaySize();
    if (!t || !overlayCtx || !overlayEl) return;
    overlayCtx.clearRect(0, 0, overlayEl.width, overlayEl.height);
    if (!trackingResult) return;
    const tr = trackingResult;
    if (liveOverlayLayers.rawDetected && tr.rawDetectedQuad) {
      drawQuadOutline(overlayCtx, mapQuadToDisplay(tr.rawDetectedQuad, t), { stroke: "rgba(255,200,0,0.65)", lineWidth: 1.5 });
    }
    if (tr.quad) {
      lastWebcamQuad = tr.quad;
      const displayQuad = mapQuadToDisplay(tr.quad, t);
      const stateColor =
        tr.state === "tracking"
          ? tr.stabilityScore >= captureReadyStability ? "#22c55e" : "#4ade80"
          : tr.state === "detected" ? "#facc15" : "rgba(148,163,184,0.7)";
      drawQuadOutline(overlayCtx, displayQuad, { stroke: stateColor, lineWidth: tr.state === "tracking" ? 3 : 2 });
      if (liveOverlayLayers.velocity && tr.cornerDeltas) {
        drawVelocityArrows(overlayCtx, displayQuad, tr.cornerDeltas, t.scale);
      }
    }
    updateStatusText(tr);
    const shutterEnabled = canUseShutter();
    captureEnabled.value = shutterEnabled;
    const ready = tracker?.isCaptureReady() ?? false;
    captureMode.value = ready ? "ready" : shutterEnabled ? "soft" : "hold";
  }

  function renderPrecaptureHints(quad: Quad | null): void {
    if (!quad) {
      if (lastPrecaptureHintsKey !== "") {
        lastPrecaptureHintsKey = "";
        hints.value = [];
      }
      return;
    }
    const { hints: h } = precaptureGuidance(
      quad,
      undefined,
      videoEl && videoEl.videoWidth > 0 ? { width: videoEl.videoWidth, height: videoEl.videoHeight } : undefined,
    );
    const hintsKey = h.join("\0");
    if (hintsKey === lastPrecaptureHintsKey) return;
    lastPrecaptureHintsKey = hintsKey;
    hints.value = h;
  }

  function runDetectionLoop(): void {
    const loopGeneration = ++liveLoopGeneration;

    const tick = () => {
      if (loopGeneration !== liveLoopGeneration || activeMode.value !== "webcam" || !tracker || !videoEl) return;

      const now = performance.now();
      if (lastTickTime) fps = fps * 0.8 + (1000 / Math.max(1, now - lastTickTime)) * 0.2;
      lastTickTime = now;

      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;
      if (vw > 0 && vh > 0) {
        const frame = capturePreviewRgba(liveDetectCtx, liveDetectCanvas, videoEl, vw, vh);
        const toVideo = frame.toSourceScale;
        const worker = getWorker();
        worker.submitLiveFrame(frame.width, frame.height, frame.data, frame.data.buffer, (result) => {
          if (loopGeneration !== liveLoopGeneration || activeMode.value !== "webcam" || !tracker) return;
          const scaled = scaleWorkerResult(result, toVideo, toVideo);
          liveResult = scaled;
          trackingResult = tracker.update(scaled);
        });
      }

      const worker = getWorker();
      if (worker.isLiveBusy && tracker) {
        trackingResult = tracker.tick();
      }

      renderPrecaptureHints(trackingResult?.quad ?? null);
      renderLiveOverlay();
      detectionLoopHandle = requestAnimationFrame(tick);
    };
    detectionLoopHandle = requestAnimationFrame(tick);
  }

  async function startWebcam(opts?: { silent?: boolean }): Promise<boolean> {
    if (mediaStream.value) return true;
    let stream: MediaStream;
    try {
      stream = await requestCameraStream();
    } catch (err) {
      if (err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "PermissionDeniedError")) {
        clearStoredCameraConsent();
      }
      if (!opts?.silent) {
        const { card, status: statusMsg } = cameraErrorMessage(err);
        permissionMessage.value = card;
        showPermission.value = true;
        status.value = statusMsg;
      }
      return false;
    }
    if (activeMode.value !== "webcam") {
      stream.getTracks().forEach((track) => track.stop());
      return false;
    }
    mediaStream.value = stream;
    const [track] = stream.getVideoTracks();
    currentVideoTrack.value = track;
    await maximizeTrackResolution(track);
    if (!videoEl) return false;
    videoEl.srcObject = mediaStream.value;
    await videoEl.play();
    if (activeMode.value !== "webcam") {
      stopWebcam();
      return false;
    }
    syncOverlaySize();
    const trackerOpts = createTrackerOptions();
    captureReadyStability = trackerOpts.captureReadyStability ?? 0.75;
    tracker = new DocumentTracker(trackerOpts);
    showPermission.value = false;
    storeCameraConsent();
    captureEnabled.value = false;
    status.value = "Looking for a document… hold it flat within the frame.";
    runDetectionLoop();
    return true;
  }

  function stopWebcam(): void {
    liveLoopGeneration++;
    try { getWorker().cancelLiveFrames(); } catch {}
    if (detectionLoopHandle !== null) {
      cancelAnimationFrame(detectionLoopHandle);
      detectionLoopHandle = null;
    }
    mediaStream.value?.getTracks().forEach((track) => track.stop());
    mediaStream.value = null;
    lastWebcamQuad = null;
    currentVideoTrack.value = null;
    liveResult = null;
    trackingResult = null;
    tracker = null;
    lastPrecaptureHintsKey = "";
    captureEnabled.value = false;
    hints.value = [];
  }

  function pauseLiveLoop(): void {
    liveLoopGeneration++;
    try { getWorker().cancelLiveFrames(); } catch {}
    if (detectionLoopHandle !== null) {
      cancelAnimationFrame(detectionLoopHandle);
      detectionLoopHandle = null;
    }
    hints.value = [];
  }

  function resumeLiveLoop(): void {
    if (activeMode.value === "webcam" && mediaStream.value && detectionLoopHandle === null && tracker) {
      runDetectionLoop();
    }
  }

  async function maybeAutoStartCamera(): Promise<void> {
    const prerequisite = cameraPrerequisiteMessage();
    if (prerequisite) {
      permissionMessage.value = prerequisite;
      showPermission.value = true;
      return;
    }
    const permission = await queryCameraPermission();
    const remembered = hasStoredCameraConsent();
    if (permission === "denied") {
      clearStoredCameraConsent();
      const { card, status: statusMsg } = cameraErrorMessage(new DOMException("denied", "NotAllowedError"));
      permissionMessage.value = card;
      showPermission.value = true;
      status.value = statusMsg;
      return;
    }
    if (permission === "granted" || remembered) {
      const started = await startWebcam({ silent: true });
      if (started) return;
      if (remembered) clearStoredCameraConsent();
      permissionMessage.value = "Allow camera access to scan documents live.";
      showPermission.value = true;
      return;
    }
    if (permission === "prompt") {
      permissionMessage.value = "Allow camera access to scan documents live.";
      showPermission.value = true;
      return;
    }
    const started = await startWebcam({ silent: true });
    if (!started) {
      permissionMessage.value = "Allow camera access to scan documents live.";
      showPermission.value = true;
    }
  }

  function getDebugState() {
    return {
      fps,
      liveDetectCanvas,
      liveResult,
      trackingResult,
      currentVideoTrack: currentVideoTrack.value,
      videoEl,
    };
  }

  onMounted(() => {
    window.addEventListener("resize", () => syncOverlaySize());
    window.addEventListener("orientationchange", () => requestAnimationFrame(() => syncOverlaySize()));
  });

  onUnmounted(() => {
    if (mediaStream.value) stopWebcam();
  });

  return {
    status,
    hints,
    captureEnabled,
    captureMode,
    showPermission,
    permissionMessage,
    liveOverlayLayers,
    mediaStream,
    currentVideoTrack,
    setElements,
    getLastWebcamQuad,
    getTrackingResult,
    getLiveResult,
    getFps,
    canUseShutter,
    startWebcam,
    stopWebcam,
    pauseLiveLoop,
    resumeLiveLoop,
    maybeAutoStartCamera,
    getDebugState,
  };
}
