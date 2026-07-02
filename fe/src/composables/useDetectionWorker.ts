import { ref } from "vue";
import { ParallelDetectionClient } from "../detection/worker/ParallelDetectionClient";

export function useDetectionWorker() {
  let worker: ParallelDetectionClient | null = null;
  const isMlAvailable = ref(false);
  const isReady = ref(false);

  async function init() {
    worker = new ParallelDetectionClient();
    await worker.whenReady();
    isMlAvailable.value = worker.isMlAvailable;
    isReady.value = true;
  }

  function getWorker(): ParallelDetectionClient {
    if (!worker) throw new Error("Detection worker not initialized");
    return worker;
  }

  return { isMlAvailable, isReady, init, getWorker };
}
