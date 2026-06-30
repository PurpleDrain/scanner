import { fuseDetection, mlToLiveWorkerResult } from "../fuseDetection";
import { MlDetectionClient } from "../ml/MlDetectionClient";
import type { MlDetectionResult } from "../ml/types";
import { DetectionWorkerClient, type DetectOptions } from "./DetectionWorkerClient";
import type { WorkerDetectionResult } from "./types";

/**
 * Live preview uses ML-only when the model is loaded (fast path).
 * OpenCV loads in the CV worker only when ML is unavailable.
 */
export class ParallelDetectionClient {
  private cv: DetectionWorkerClient | null = null;
  private readonly ml = new MlDetectionClient();
  private liveBusy = false;
  private queuedLive: {
    width: number;
    height: number;
    data: Uint8ClampedArray;
    onResult: (result: WorkerDetectionResult) => void;
    onError: (error: Error) => void;
  } | null = null;

  private ensureCvWorker(): DetectionWorkerClient {
    if (!this.cv) this.cv = new DetectionWorkerClient();
    return this.cv;
  }

  get isLiveBusy(): boolean {
    return this.liveBusy || (this.cv?.isLiveBusy ?? false) || this.ml.isLiveBusy;
  }

  get isMlAvailable(): boolean {
    return this.ml.isAvailable;
  }

  async whenReady(): Promise<void> {
    await this.ml.whenReady();
    if (!this.ml.isAvailable) {
      await this.ensureCvWorker().whenReady();
    }
  }

  submitLiveFrame(
    width: number,
    height: number,
    data: Uint8ClampedArray,
    transfer: ArrayBufferLike,
    onResult: (result: WorkerDetectionResult) => void,
    onError?: (error: Error) => void,
  ): void {
    if (this.liveBusy) {
      this.queuedLive = {
        width,
        height,
        data: new Uint8ClampedArray(data),
        onResult,
        onError: onError ?? (() => {}),
      };
      return;
    }

    if (this.ml.isAvailable) {
      this.runLiveMlOnly(width, height, data, transfer, onResult, onError ?? (() => {}));
    } else {
      this.runLiveCvOnly(width, height, data, transfer, onResult, onError ?? (() => {}));
    }
  }

  async detectPreview(
    width: number,
    height: number,
    data: Uint8ClampedArray,
    _transfer: ArrayBufferLike,
  ): Promise<WorkerDetectionResult> {
    if (this.ml.isAvailable) {
      const frame = new Uint8ClampedArray(data);
      const ml = await this.ml.detect(width, height, frame, frame.buffer).catch((): MlDetectionResult => ({
        quad: null,
        confidence: 0,
        timings: {},
      }));
      return mlToLiveWorkerResult(ml);
    }

    const cvData = new Uint8ClampedArray(data);
    return this.ensureCvWorker().detect(width, height, cvData, cvData.buffer, {
      mode: "full",
      profile: "live",
      debug: false,
    });
  }

  /** Full-resolution CV + ML parallel path (legacy; prefer {@link detectPreview}). */
  async detect(
    width: number,
    height: number,
    data: Uint8ClampedArray,
    _transfer: ArrayBufferLike,
    options: DetectOptions,
  ): Promise<WorkerDetectionResult> {
    const mlData = new Uint8ClampedArray(data);
    const cvData = new Uint8ClampedArray(data);

    const [cvResult, mlResult] = await Promise.all([
      this.ensureCvWorker().detect(width, height, cvData, cvData.buffer, options),
      this.ml.isAvailable
        ? this.ml.detect(width, height, mlData, mlData.buffer).catch((): MlDetectionResult => ({
            quad: null,
            confidence: 0,
            timings: {},
          }))
        : Promise.resolve({ quad: null, confidence: 0, timings: {} } as MlDetectionResult),
    ]);

    return fuseDetection(cvResult, mlResult);
  }

  cancelLiveFrames(): void {
    this.queuedLive = null;
    this.liveBusy = false;
    this.cv?.cancelLiveFrames();
    this.ml.cancelLiveFrames();
  }

  terminate(): void {
    this.queuedLive = null;
    this.liveBusy = false;
    this.cv?.terminate();
    this.ml.terminate();
  }

  private runLiveMlOnly(
    width: number,
    height: number,
    data: Uint8ClampedArray,
    transfer: ArrayBufferLike,
    onResult: (result: WorkerDetectionResult) => void,
    onError: (error: Error) => void,
  ): void {
    this.liveBusy = true;
    const frame = new Uint8ClampedArray(data);
    this.ml.submitLiveFrame(
      width,
      height,
      frame,
      frame.buffer,
      (ml) => {
        this.liveBusy = false;
        onResult(mlToLiveWorkerResult(ml));
        this.flushQueuedLive();
      },
      (error) => {
        this.liveBusy = false;
        onError(error);
        this.flushQueuedLive();
      },
    );
    void transfer;
  }

  private runLiveCvOnly(
    width: number,
    height: number,
    data: Uint8ClampedArray,
    transfer: ArrayBufferLike,
    onResult: (result: WorkerDetectionResult) => void,
    onError: (error: Error) => void,
  ): void {
    this.liveBusy = true;
    const frame = new Uint8ClampedArray(data);
    this.ensureCvWorker().submitLiveFrame(
      width,
      height,
      frame,
      frame.buffer,
      (result) => {
        this.liveBusy = false;
        onResult(result);
        this.flushQueuedLive();
      },
      (error) => {
        this.liveBusy = false;
        onError(error);
        this.flushQueuedLive();
      },
    );
    void transfer;
  }

  private flushQueuedLive(): void {
    const queued = this.queuedLive;
    if (!queued) return;
    this.queuedLive = null;
    const transfer = queued.data.buffer;
    this.submitLiveFrame(queued.width, queued.height, queued.data, transfer, queued.onResult, queued.onError);
  }
}
