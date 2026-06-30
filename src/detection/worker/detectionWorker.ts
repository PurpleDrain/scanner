/// <reference lib="webworker" />
import type { CV } from "@techstark/opencv-js";
import { loadOpenCv } from "../../opencv";
import { detectDocument } from "../detectDocument";
import { CAPTURE_WORKER_CONFIG, LIVE_WORKER_CONFIG } from "../workerConfig";
import { matFromRgba } from "./matFromRgba";
import type { WorkerDetectRequest, WorkerInboundMessage, WorkerOutboundMessage } from "./types";

let cvReady: Promise<CV> | null = null;

function ensureCv(): Promise<CV> {
  if (!cvReady) {
    cvReady = loadOpenCv();
  }
  return cvReady;
}

async function handleDetect(msg: WorkerDetectRequest): Promise<void> {
  const opencv = await ensureCv();
  const src = matFromRgba(opencv, msg.data, msg.width, msg.height);
  try {
    const config = msg.profile === "live" ? LIVE_WORKER_CONFIG : CAPTURE_WORKER_CONFIG;
    const result = detectDocument(opencv, src, { mode: msg.mode, debug: msg.debug }, config);
    const outbound: WorkerOutboundMessage = { type: "result", id: msg.id, result };
    self.postMessage(outbound);
  } finally {
    src.delete();
  }
}

self.onmessage = (event: MessageEvent<WorkerInboundMessage>) => {
  const msg = event.data;
  if (msg.type !== "detect") return;

  void handleDetect(msg).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const outbound: WorkerOutboundMessage = { type: "error", id: msg.id, message };
    self.postMessage(outbound);
  });
};

// Worker is ready immediately; OpenCV loads on first CV detect request.
const ready: WorkerOutboundMessage = { type: "ready" };
self.postMessage(ready);
