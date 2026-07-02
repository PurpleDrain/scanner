/// <reference lib="webworker" />
import { detectDocumentMl, preloadDocAlignerModel } from "./docAlignerModel";
import type { MlDetectRequest, MlInboundMessage, MlOutboundMessage } from "./types";

async function handleDetect(msg: MlDetectRequest): Promise<void> {
  const result = await detectDocumentMl(msg.data, msg.width, msg.height);
  const outbound: MlOutboundMessage = { type: "result", id: msg.id, result };
  self.postMessage(outbound);
}

self.onmessage = (event: MessageEvent<MlInboundMessage>) => {
  const msg = event.data;
  if (msg.type !== "detect") return;

  void handleDetect(msg).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const outbound: MlOutboundMessage = { type: "error", id: msg.id, message };
    self.postMessage(outbound);
  });
};

void preloadDocAlignerModel()
  .then(() => {
    const ready: MlOutboundMessage = { type: "ready" };
    self.postMessage(ready);
  })
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    const outbound: MlOutboundMessage = { type: "unavailable", message };
    self.postMessage(outbound);
  });
