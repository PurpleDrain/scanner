import type { MlDetectionResult, MlOutboundMessage } from "./types";

type Pending = {
  resolve: (result: MlDetectionResult) => void;
  reject: (error: Error) => void;
};

/**
 * Web worker client for DocAligner LCNet100 corner detection.
 * Mirrors the CV worker API shape for parallel orchestration.
 */
export class MlDetectionClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readyResolve!: () => void;
  private readonly ready: Promise<void>;
  private available = false;
  private unavailableReason: string | null = null;
  private liveBusy = false;
  private queuedLive: {
    width: number;
    height: number;
    data: Uint8ClampedArray;
    onResult: (result: MlDetectionResult) => void;
    onError: (error: Error) => void;
  } | null = null;

  constructor() {
    this.ready = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });
    this.worker = new Worker(new URL("./mlDetectionWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<MlOutboundMessage>) => this.onMessage(event.data);
    this.worker.onerror = (event) => {
      this.available = false;
      this.unavailableReason = event.message || "ML worker error";
      for (const [, p] of this.pending) p.reject(new Error(this.unavailableReason));
      this.pending.clear();
    };
  }

  get isAvailable(): boolean {
    return this.available;
  }

  get isLiveBusy(): boolean {
    return this.liveBusy;
  }

  async whenReady(): Promise<void> {
    return this.ready;
  }

  submitLiveFrame(
    width: number,
    height: number,
    data: Uint8ClampedArray,
    transfer: ArrayBufferLike,
    onResult: (result: MlDetectionResult) => void,
    onError?: (error: Error) => void,
  ): void {
    if (!this.available) return;
    void this.ready.then(() => {
      if (!this.available) return;
      if (this.liveBusy) {
        this.queuedLive = {
          width,
          height,
          data,
          onResult,
          onError: onError ?? (() => {}),
        };
        return;
      }
      this.sendLive(width, height, data, transfer, onResult, onError ?? (() => {}));
    });
  }

  async detect(
    width: number,
    height: number,
    data: Uint8ClampedArray,
    transfer: ArrayBufferLike,
  ): Promise<MlDetectionResult> {
    await this.ready;
    if (!this.available) {
      return { quad: null, confidence: 0, timings: {} };
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker!.postMessage({ type: "detect", id, width, height, data }, [transfer as ArrayBuffer]);
    });
  }

  cancelLiveFrames(): void {
    this.queuedLive = null;
    this.liveBusy = false;
  }

  terminate(): void {
    this.worker?.terminate();
    this.worker = null;
    this.available = false;
    this.queuedLive = null;
    this.liveBusy = false;
    for (const [, p] of this.pending) p.reject(new Error("ML worker terminated"));
    this.pending.clear();
  }

  private sendLive(
    width: number,
    height: number,
    data: Uint8ClampedArray,
    transfer: ArrayBufferLike,
    onResult: (result: MlDetectionResult) => void,
    onError: (error: Error) => void,
  ): void {
    const id = this.nextId++;
    this.liveBusy = true;
    this.pending.set(id, {
      resolve: (result) => {
        this.liveBusy = false;
        onResult(result);
        this.flushQueuedLive();
      },
      reject: (error) => {
        this.liveBusy = false;
        onError(error);
        this.flushQueuedLive();
      },
    });
    this.worker!.postMessage({ type: "detect", id, width, height, data }, [transfer as ArrayBuffer]);
  }

  private flushQueuedLive(): void {
    const queued = this.queuedLive;
    if (!queued) return;
    this.queuedLive = null;
    const transfer = queued.data.buffer;
    this.sendLive(queued.width, queued.height, queued.data, transfer, queued.onResult, queued.onError);
  }

  private onMessage(msg: MlOutboundMessage): void {
    if (msg.type === "ready") {
      this.available = true;
      this.readyResolve();
      return;
    }
    if (msg.type === "unavailable") {
      this.available = false;
      this.unavailableReason = msg.message;
      this.readyResolve();
      return;
    }
    if (msg.type === "error") {
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        p.reject(new Error(msg.message));
      }
      return;
    }
    const p = this.pending.get(msg.id);
    if (p) {
      this.pending.delete(msg.id);
      p.resolve(msg.result);
    }
  }
}
