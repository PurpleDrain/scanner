import { ref } from "vue";
import type { Ref } from "vue";
import { capturePreviewRgba, CAPTURE_DETECT_MAX_DIM } from "../detection/previewFrame";
import { scaleWorkerResult } from "../detection/fuseDetection";
import { scaleQuad } from "../detection/geometry";
import { drawQuadOutline, type Quad } from "../documentScanner";
import type { DetectionResult } from "../detection/types";
import type { ParallelDetectionClient } from "../detection/worker/ParallelDetectionClient";

type Mode = "webcam" | "upload";

const UPLOAD_PREVIEW_MAX_WIDTH = 720;

export interface EditorStill {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  quad: Quad;
}

export function useCapture(deps: {
  getWorker: () => ParallelDetectionClient;
  activeMode: Ref<Mode>;
  canUseShutter: () => boolean;
  getLastWebcamQuad: () => Quad | null;
  getLiveOverlayLayers: () => { rawDetected: boolean; velocity: boolean };
  beginProcessing: (msg: string) => void;
  endProcessing: () => void;
  updateProcessingMessage: (msg: string) => void;
  setStatus: (msg: string) => void;
}) {
  const { getWorker, activeMode, canUseShutter, getLastWebcamQuad, getLiveOverlayLayers } = deps;

  const captureCanvas = document.createElement("canvas");
  const captureCtx = captureCanvas.getContext("2d")!;
  const uploadCanvas = document.createElement("canvas");
  const uploadCtx = uploadCanvas.getContext("2d")!;

  const captureResult = ref<DetectionResult | null>(null);
  const captureSrcWidth = ref(0);
  const captureSrcHeight = ref(0);

  async function detectAtCaptureResolution(
    source: CanvasImageSource,
    srcWidth: number,
    srcHeight: number,
  ) {
    const frame = capturePreviewRgba(captureCtx, captureCanvas, source, srcWidth, srcHeight, CAPTURE_DETECT_MAX_DIM);
    const worker = getWorker();
    const result = await worker.detectPreview(frame.width, frame.height, frame.data, frame.data.buffer);
    return scaleWorkerResult(result, frame.toSourceScale, frame.toSourceScale);
  }

  function freezeFrame(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    canvas.getContext("2d")!.drawImage(source, 0, 0, width, height);
    return canvas;
  }

  function renderUploadPreview(image: HTMLImageElement, previewScale: number, result: DetectionResult | null): void {
    uploadCanvas.width = Math.round(image.width * previewScale);
    uploadCanvas.height = Math.round(image.height * previewScale);
    uploadCtx.drawImage(image, 0, 0, uploadCanvas.width, uploadCanvas.height);
    if (!result) return;
    const layers = getLiveOverlayLayers();
    if (layers.rawDetected && result.quad) {
      drawQuadOutline(uploadCtx, scaleQuad(result.quad, previewScale, previewScale), {
        stroke: "rgba(255,200,0,0.9)",
        lineWidth: 2.5,
        cornerRadius: 5,
      });
    }
  }

  async function captureAndFlatten(videoEl: HTMLVideoElement): Promise<EditorStill | null> {
    if (!canUseShutter()) {
      deps.setStatus("枠の中に書類が入るように、カメラを向けてください。");
      return null;
    }
    const fallbackQuad = getLastWebcamQuad()!;
    deps.beginProcessing("撮影しています…");
    try {
      const still = freezeFrame(videoEl, videoEl.videoWidth, videoEl.videoHeight);
      captureSrcWidth.value = still.width;
      captureSrcHeight.value = still.height;
      deps.updateProcessingMessage("四隅を調整しています…");
      captureResult.value = await detectAtCaptureResolution(still, still.width, still.height);
      const quad = captureResult.value.quad ?? fallbackQuad;
      if (!quad) {
        deps.setStatus("書類の端を見つけられませんでした。位置を少し変えて、もう一度撮影をお願いします。");
        return null;
      }
      return { canvas: still, width: still.width, height: still.height, quad };
    } catch {
      deps.setStatus("うまく読み取れませんでした。お手数ですが、もう一度お試しください。");
      return null;
    } finally {
      deps.endProcessing();
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

  async function handleFileSelected(file: File): Promise<EditorStill | null> {
    activeMode.value = "upload";
    deps.beginProcessing("画像を読み込んでいます…");
    try {
      const image = await loadImageFile(file);
      const previewScale = Math.min(1, UPLOAD_PREVIEW_MAX_WIDTH / image.width);
      deps.updateProcessingMessage("書類を検出しています…");
      renderUploadPreview(image, previewScale, null);
      captureResult.value = await detectAtCaptureResolution(image, image.width, image.height);
      captureSrcWidth.value = image.width;
      captureSrcHeight.value = image.height;
      renderUploadPreview(image, previewScale, captureResult.value);
      const quad = captureResult.value.quad;
      if (!quad) {
        deps.setStatus("書類の端を見つけられませんでした。別の画像でお試しください。");
        activeMode.value = "webcam";
        return null;
      }
      const conf = captureResult.value.confidence ? `（確度 ${captureResult.value.confidence.value.toFixed(2)}）` : "";
      deps.setStatus(`書類を検出しました${conf}。`);
      const still = freezeFrame(image, image.width, image.height);
      return { canvas: still, width: image.width, height: image.height, quad };
    } catch {
      deps.setStatus("この画像からは読み取れませんでした。別の画像でお試しください。");
      activeMode.value = "webcam";
      return null;
    } finally {
      deps.endProcessing();
    }
  }

  return {
    captureResult,
    captureSrcWidth,
    captureSrcHeight,
    captureAndFlatten,
    handleFileSelected,
  };
}
