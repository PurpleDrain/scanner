<script setup lang="ts">
import { ref, nextTick, watch, onMounted } from "vue";
import CameraView from "./components/CameraView.vue";
import DebugModal from "./components/DebugModal.vue";
import CornerEditorModal from "./components/CornerEditorModal.vue";
import ResultModal from "./components/ResultModal.vue";
import ProcessingSpinner from "./components/ProcessingSpinner.vue";
import { useProcessing } from "./composables/useProcessing";
import { useDetectionWorker } from "./composables/useDetectionWorker";
import { useCameraSession } from "./composables/useCameraSession";
import { useCapture } from "./composables/useCapture";
import { useResult } from "./composables/useResult";
import { PREVIEW_DETECT_MAX_DIM } from "./detection/previewFrame";
import type { DetectionResult } from "./detection/types";

// ── Modal state ──────────────────────────────────────────────────────────────

const activeMode = ref<"webcam" | "upload">("webcam");
const editorOpen = ref(false);
const resultOpen = ref(false);
const debugOpen = ref(false);
const enhanceEnabled = ref(true);

// ── Component refs ───────────────────────────────────────────────────────────

const cameraViewRef = ref<InstanceType<typeof CameraView> | null>(null);
const editorModalRef = ref<InstanceType<typeof CornerEditorModal> | null>(null);
const resultModalRef = ref<InstanceType<typeof ResultModal> | null>(null);
const fileInputRef = ref<HTMLInputElement | null>(null);

let editorStill: { canvas: HTMLCanvasElement; width: number; height: number } | null = null;

// ── Composables ──────────────────────────────────────────────────────────────

const processing = useProcessing();
const { isProcessing, processingMessage, beginProcessing, endProcessing, updateProcessingMessage } = processing;

const worker = useDetectionWorker();

const camera = useCameraSession({
  getWorker: worker.getWorker,
  isMlAvailable: worker.isMlAvailable,
  activeMode,
});

const {
  status: cameraStatus,
  hints,
  captureEnabled,
  captureMode,
  showPermission,
  permissionMessage,
  liveOverlayLayers,
  mediaStream,
} = camera;

const capture = useCapture({
  getWorker: worker.getWorker,
  activeMode,
  canUseShutter: camera.canUseShutter,
  getLastWebcamQuad: camera.getLastWebcamQuad,
  getLiveOverlayLayers: () => camera.liveOverlayLayers,
  beginProcessing,
  endProcessing,
  updateProcessingMessage,
  setStatus: (msg) => { cameraStatus.value = msg; },
});

const result = useResult();
const { lastQuality, lastFlattenedSize } = result;

// ── Debug rows ───────────────────────────────────────────────────────────────

const debugRows = ref<[string, string][]>([]);

function appendResultRows(rows: [string, string][], label: string, r: DetectionResult | null): void {
  if (!r) return;
  const total = Math.round(Object.values(r.timings).reduce((a, b) => a + b, 0));
  rows.push([`${label} detect time`, `${total} ms`]);
  rows.push([`${label} confidence`, r.confidence ? r.confidence.value.toFixed(2) : "—"]);
  const stages = Object.entries(r.timings).map(([k, v]) => `${k.slice(0, 4)} ${Math.round(v)}`).join(", ");
  rows.push([`${label} stages (ms)`, stages]);
}

function buildDebugRows(): [string, string][] {
  const debug = camera.getDebugState();
  const rows: [string, string][] = [
    ["ML detector", worker.isMlAvailable.value ? "ready" : "unavailable"],
    ["Export min width", "2400 px"],
  ];

  if (activeMode.value === "webcam" && debug.currentVideoTrack && debug.videoEl) {
    const settings = debug.currentVideoTrack.getSettings();
    const capabilities = debug.currentVideoTrack.getCapabilities?.() ?? {};
    const deviceMaxRes =
      (capabilities as MediaTrackCapabilities).width?.max && (capabilities as MediaTrackCapabilities).height?.max
        ? `${(capabilities as MediaTrackCapabilities).width!.max} × ${(capabilities as MediaTrackCapabilities).height!.max}`
        : "unknown";
    rows.unshift(
      ["Capture resolution", `${debug.videoEl.videoWidth} × ${debug.videoEl.videoHeight}`],
      ["Device max resolution", deviceMaxRes],
      ["Frame rate", settings.frameRate ? `${settings.frameRate.toFixed(1)} fps` : "unknown"],
      ["Facing mode", settings.facingMode ?? "unknown"],
      ["Live detect size", `${debug.liveDetectCanvas.width} × ${debug.liveDetectCanvas.height} (max ${PREVIEW_DETECT_MAX_DIM}px)`],
      ["Live FPS", debug.fps ? debug.fps.toFixed(0) : "—"],
      ["Detection cadence", worker.isMlAvailable.value ? "every frame (ML)" : "ML unavailable"],
      ["Detection thread", "web worker"],
    );
    try {
      rows.splice(9, 0, ["Worker status", worker.getWorker().isLiveBusy ? "busy" : "idle"]);
    } catch {}
    appendResultRows(rows, "Live", debug.liveResult);
    if (debug.trackingResult) {
      const tr = debug.trackingResult;
      rows.push(["Tracker state", tr.state]);
      rows.push(["Detection confidence", tr.detectionConfidence ? tr.detectionConfidence.toFixed(2) : "—"]);
      rows.push(["Tracking confidence", tr.trackingConfidence.toFixed(2)]);
      rows.push(["Stability score", tr.stabilityScore.toFixed(2)]);
      rows.push(["Corner velocity", tr.cornerVelocity ? `${tr.cornerVelocity.toFixed(1)} px/det` : "0"]);
    }
  }

  if (activeMode.value === "upload" && capture.captureSrcWidth.value > 0) {
    rows.unshift(
      ["Upload image size", `${capture.captureSrcWidth.value} × ${capture.captureSrcHeight.value}`],
      ["Upload detect size", `${debug.liveDetectCanvas.width} × ${debug.liveDetectCanvas.height} (max ${PREVIEW_DETECT_MAX_DIM}px)`],
    );
    appendResultRows(rows, "Upload", capture.captureResult.value);
  }

  if (lastFlattenedSize.value) {
    rows.push(["Last flattened size", `${lastFlattenedSize.value.width} × ${lastFlattenedSize.value.height}`]);
  }

  return rows;
}

// ── Event handlers ───────────────────────────────────────────────────────────

async function onCapture(): Promise<void> {
  const video = cameraViewRef.value?.videoEl;
  if (!video) return;
  const still = await capture.captureAndFlatten(video);
  if (!still) return;
  editorStill = { canvas: still.canvas, width: still.width, height: still.height };
  editorOpen.value = true;
  await nextTick();
  editorModalRef.value!.initEditor(still.canvas, still.width, still.height, still.quad);
}

async function onFlatten(): Promise<void> {
  if (!editorStill || !editorModalRef.value) return;
  const quad = editorModalRef.value.getQuad();
  editorOpen.value = false;
  activeMode.value = "webcam";
  const warp = await result.flattenFromEditor(editorStill, quad, { beginProcessing, endProcessing });
  editorStill = null;
  if (!warp) return;
  resultOpen.value = true;
  await nextTick();
  resultModalRef.value!.showResult(warp.data, warp.width, warp.height);
}

function onEditorClose(): void {
  editorOpen.value = false;
  editorStill = null;
  activeMode.value = "webcam";
  if (mediaStream.value) camera.resumeLiveLoop();
  else void camera.maybeAutoStartCamera();
}

function onResultClose(): void {
  resultOpen.value = false;
  if (!mediaStream.value) void camera.maybeAutoStartCamera();
}

function openGalleryPicker(): void {
  if (!fileInputRef.value) return;
  fileInputRef.value.value = "";
  fileInputRef.value.click();
}

async function onFileSelected(): Promise<void> {
  const file = fileInputRef.value?.files?.[0];
  if (!file) return;
  camera.pauseLiveLoop();
  const still = await capture.handleFileSelected(file);
  if (fileInputRef.value) fileInputRef.value.value = "";
  if (!still) {
    activeMode.value = "webcam";
    if (mediaStream.value) camera.resumeLiveLoop();
    else void camera.maybeAutoStartCamera();
    return;
  }
  editorStill = { canvas: still.canvas, width: still.width, height: still.height };
  editorOpen.value = true;
  await nextTick();
  editorModalRef.value!.initEditor(still.canvas, still.width, still.height, still.quad);
}

function onOpenDebug(): void {
  debugRows.value = buildDebugRows();
  debugOpen.value = true;
}

function onOverlayLayersUpdate(layers: { rawDetected: boolean; velocity: boolean }): void {
  liveOverlayLayers.rawDetected = layers.rawDetected;
  liveOverlayLayers.velocity = layers.velocity;
}

// ── Watchers ─────────────────────────────────────────────────────────────────

watch(editorOpen, (open) => {
  if (open) camera.pauseLiveLoop();
  // Resume is handled explicitly in onEditorClose() to prevent a brief
  // restart during the async gap between editor close and result open.
});

watch(resultOpen, (open) => {
  if (open) camera.stopWebcam();
});

// ── Init ─────────────────────────────────────────────────────────────────────

onMounted(async () => {
  await nextTick();
  const video = cameraViewRef.value?.videoEl;
  const overlay = cameraViewRef.value?.overlayEl;
  if (video && overlay) camera.setElements(video, overlay);

  beginProcessing("Loading detector…");
  try {
    await worker.init();
    const httpsHint = window.isSecureContext ? "" : " Use the https:// link on your phone.";
    cameraStatus.value = worker.isMlAvailable.value
      ? `Tap Allow camera to start scanning.${httpsHint}`
      : `ML detector unavailable — you can still choose from gallery.${httpsHint}`;
    await camera.maybeAutoStartCamera();
  } finally {
    endProcessing();
  }
});
</script>

<template>
  <CameraView
    ref="cameraViewRef"
    :status="cameraStatus"
    :hints="hints"
    :capture-enabled="captureEnabled"
    :capture-mode="captureMode"
    :show-permission="showPermission"
    :permission-message="permissionMessage"
    @capture="onCapture"
    @allow-camera="() => camera.startWebcam()"
    @choose-gallery="openGalleryPicker"
    @open-debug="onOpenDebug"
  />

  <input ref="fileInputRef" type="file" accept="image/*" hidden @change="onFileSelected" />

  <DebugModal
    :open="debugOpen"
    :rows="debugRows"
    :overlay-layers="liveOverlayLayers"
    @close="debugOpen = false"
    @update:overlay-layers="onOverlayLayersUpdate"
  />

  <CornerEditorModal
    ref="editorModalRef"
    :open="editorOpen"
    :is-flattening="isProcessing"
    @close="onEditorClose"
    @flatten="onFlatten"
  />

  <ResultModal
    ref="resultModalRef"
    :open="resultOpen"
    :quality="lastQuality"
    :enhanced="enhanceEnabled"
    @close="onResultClose"
    @update:enhanced="(v) => { enhanceEnabled = v; }"
  />

  <ProcessingSpinner :open="isProcessing" :message="processingMessage" />
</template>
