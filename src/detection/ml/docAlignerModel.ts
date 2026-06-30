import * as ort from "onnxruntime-web/wasm";
import ortMjsUrl from "onnxruntime-web/ort-wasm-simd-threaded.mjs?url";
import ortWasmUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import { orderCorners } from "../geometry";
import type { Quad } from "../types";
import { centroidOnHeatmap, maxHeatmapValue } from "./heatmap";
import type { MlDetectionResult } from "./types";

export const DOC_ALIGNER_INPUT_SIZE = 256;
export const DOC_ALIGNER_MODEL_URL = "/models/lcnet100_h_e_bifpn_256_fp32.onnx";
const HEATMAP_THRESHOLD = 0.3;

ort.env.wasm.wasmPaths = { mjs: ortMjsUrl, wasm: ortWasmUrl };
ort.env.wasm.numThreads = 1;

let sessionPromise: Promise<ort.InferenceSession> | null = null;

async function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = ort.InferenceSession.create(DOC_ALIGNER_MODEL_URL, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
  }
  return sessionPromise;
}

/** Nearest-neighbour downscale RGBA → NCHW float tensor (no canvas). */
function preprocessRgba(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { tensor: ort.Tensor; origWidth: number; origHeight: number } {
  const size = DOC_ALIGNER_INPUT_SIZE;
  const plane = size * size;
  const tensorData = new Float32Array(3 * plane);
  const scaleX = width / size;
  const scaleY = height / size;

  for (let y = 0; y < size; y++) {
    const srcY = Math.min(height - 1, Math.floor((y + 0.5) * scaleY - 0.5));
    const srcRow = srcY * width;
    const rowOff = y * size;
    for (let x = 0; x < size; x++) {
      const srcX = Math.min(width - 1, Math.floor((x + 0.5) * scaleX - 0.5));
      const si = (srcRow + srcX) * 4;
      const pi = rowOff + x;
      tensorData[pi] = data[si] / 255;
      tensorData[plane + pi] = data[si + 1] / 255;
      tensorData[2 * plane + pi] = data[si + 2] / 255;
    }
  }

  return {
    tensor: new ort.Tensor("float32", tensorData, [1, 3, size, size]),
    origWidth: width,
    origHeight: height,
  };
}

export function postprocessHeatmaps(
  heatmaps: Float32Array,
  heatW: number,
  heatH: number,
  origW: number,
  origH: number,
): { quad: Quad | null; confidence: number } {
  const channelSize = heatW * heatH;
  const corners: { x: number; y: number }[] = [];
  let peakSum = 0;

  for (let c = 0; c < 4; c++) {
    const channel = heatmaps.subarray(c * channelSize, (c + 1) * channelSize);
    peakSum += maxHeatmapValue(channel);
    const pt = centroidOnHeatmap(channel, heatW, heatH, origW, origH, HEATMAP_THRESHOLD);
    if (!pt) return { quad: null, confidence: 0 };
    corners.push(pt);
  }

  return {
    quad: orderCorners(corners),
    confidence: Math.max(0, Math.min(1, peakSum / 4)),
  };
}

export async function detectDocumentMl(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<MlDetectionResult> {
  const t0 = performance.now();
  const session = await getSession();
  const prep = preprocessRgba(data, width, height);
  const prepMs = performance.now() - t0;

  const inputName = session.inputNames[0] ?? "img";
  const t1 = performance.now();
  const outputs = await session.run({ [inputName]: prep.tensor });
  const inferMs = performance.now() - t1;

  const outputName = session.outputNames.find((n) => n.includes("heatmap")) ?? session.outputNames[0];
  const heatmapTensor = outputs[outputName];
  if (!heatmapTensor) throw new Error(`Missing heatmap output (got: ${session.outputNames.join(", ")})`);

  const [, , heatH, heatW] = heatmapTensor.dims as [number, number, number, number];
  const heatmaps = heatmapTensor.data as Float32Array;

  const t2 = performance.now();
  const { quad, confidence } = postprocessHeatmaps(heatmaps, heatW, heatH, prep.origWidth, prep.origHeight);
  const postMs = performance.now() - t2;

  return {
    quad,
    confidence,
    timings: {
      ml_preprocess_ms: prepMs,
      ml_inference_ms: inferMs,
      ml_postprocess_ms: postMs,
    },
  };
}

export async function preloadDocAlignerModel(): Promise<void> {
  await getSession();
}
