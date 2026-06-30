import { mlToWorkerResult } from "../fuseDetection";
import { MlDetectionClient } from "../ml/MlDetectionClient";
import type { MlDetectionResult } from "../ml/types";
import type { WorkerDetectionResult } from "./types";

const EMPTY_ML: MlDetectionResult = { quad: null, confidence: 0, timings: {} };

/**
 * Detection client backed solely by the ML model (DocAligner) running in a web worker.
 * The live preview, capture, and upload paths all go through the same small-frame ML detection.
 */
export class ParallelDetectionClient {
  private readonly ml = new MlDetectionClient();

  get isLiveBusy(): boolean {
    return this.ml.isLiveBusy;
  }

  get isMlAvailable(): boolean {
    return this.ml.isAvailable;
  }

  async whenReady(): Promise<void> {
    await this.ml.whenReady();
  }

  submitLiveFrame(
    width: number,
    height: number,
    data: Uint8ClampedArray,
    transfer: ArrayBufferLike,
    onResult: (result: WorkerDetectionResult) => void,
    onError?: (error: Error) => void,
  ): void {
    this.ml.submitLiveFrame(
      width,
      height,
      data,
      transfer,
      (ml) => onResult(mlToWorkerResult(ml)),
      onError,
    );
  }

  async detectPreview(
    width: number,
    height: number,
    data: Uint8ClampedArray,
    transfer: ArrayBufferLike,
  ): Promise<WorkerDetectionResult> {
    const ml = await this.ml.detect(width, height, data, transfer).catch(() => EMPTY_ML);
    return mlToWorkerResult(ml);
  }

  cancelLiveFrames(): void {
    this.ml.cancelLiveFrames();
  }

  terminate(): void {
    this.ml.terminate();
  }
}
