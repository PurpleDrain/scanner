import type { DetectionMode } from "../types";
import type { WorkerDetectionResult, WorkerOutboundMessage } from "./types";

export interface DetectOptions {
  mode: DetectionMode;
  profile: "live" | "capture";
  debug?: boolean;
}

type Pending = {
  resolve: (result: WorkerDetectionResult) => void;
  reject: (error: Error) => void;
};

/**
 * Thin wrapper around the CV detection web worker. Supports queued live frames (keeps only the
 * newest while busy) and awaited detect requests.
 */
export class DetectionWorkerClient {
  private worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly liveRequestIds = new Set<number>();
  private readyResolve!: () => void;
  private readonly ready: Promise<void>;
  private liveBusy = false;
  private queuedLive: {
    width: number;
    height: number;
    data: Uint8ClampedArray;
    onResult: (result: WorkerDetectionResult) => void;
    onError: (error: Error) => void;
  } | null = null;

  constructor() {
    this.ready = new Promise<void>((resolve) => {
      this.readyResolve = resolve;
    });
    this.worker = new Worker(new URL("./detectionWorker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => this.onMessage(event.data);
    this.worker.onerror = (event) => {
      for (const [, p] of this.pending) p.reject(new Error(event.message || "Worker error"));
      this.pending.clear();
    };
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
    onResult: (result: WorkerDetectionResult) => void,
    onError?: (error: Error) => void,
  ): void {
    void this.ready.then(() => {
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
    options: DetectOptions,
  ): Promise<WorkerDetectionResult> {
    await this.ready;
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage(
        {
          type: "detect",
          id,
          width,
          height,
          data,
          mode: options.mode,
          profile: options.profile,
          debug: options.debug,
        },
        [transfer as ArrayBuffer],
      );
    });
  }

  cancelLiveFrames(): void {
    this.queuedLive = null;
    this.liveBusy = false;
    for (const id of this.liveRequestIds) {
      this.pending.delete(id);
    }
    this.liveRequestIds.clear();
  }

  terminate(): void {
    this.worker.terminate();
    this.queuedLive = null;
    this.liveBusy = false;
    this.liveRequestIds.clear();
    for (const [, p] of this.pending) p.reject(new Error("Worker terminated"));
    this.pending.clear();
  }

  private sendLive(
    width: number,
    height: number,
    data: Uint8ClampedArray,
    transfer: ArrayBufferLike,
    onResult: (result: WorkerDetectionResult) => void,
    onError: (error: Error) => void,
  ): void {
    const id = this.nextId++;
    this.liveBusy = true;
    this.liveRequestIds.add(id);
    this.pending.set(id, {
      resolve: (result) => {
        this.liveRequestIds.delete(id);
        this.liveBusy = false;
        onResult(result);
        this.flushQueuedLive();
      },
      reject: (error) => {
        this.liveRequestIds.delete(id);
        this.liveBusy = false;
        onError(error);
        this.flushQueuedLive();
      },
    });
    this.worker.postMessage(
      {
        type: "detect",
        id,
        width,
        height,
        data,
        mode: "full",
        profile: "live",
        debug: false,
      },
      [transfer as ArrayBuffer],
    );
  }

  private flushQueuedLive(): void {
    const queued = this.queuedLive;
    if (!queued) return;
    this.queuedLive = null;
    const transfer = queued.data.buffer;
    this.sendLive(queued.width, queued.height, queued.data, transfer, queued.onResult, queued.onError);
  }

  private onMessage(msg: WorkerOutboundMessage): void {
    if (msg.type === "ready") {
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
