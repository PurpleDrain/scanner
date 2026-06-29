import cvModule from "@techstark/opencv-js";
import type { CV } from "@techstark/opencv-js";

let cvPromise: Promise<CV> | null = null;

/** Resolves once the OpenCV.js WASM runtime has finished loading. */
export function loadOpenCv(): Promise<CV> {
  if (!cvPromise) {
    cvPromise = (async () => {
      const mod = cvModule as unknown;
      if (mod instanceof Promise) {
        return (await mod) as CV;
      }
      const maybeReady = mod as CV & { Mat?: unknown; onRuntimeInitialized?: () => void };
      if (maybeReady.Mat) {
        return maybeReady;
      }
      await new Promise<void>((resolve) => {
        maybeReady.onRuntimeInitialized = () => resolve();
      });
      return maybeReady;
    })();
  }
  return cvPromise;
}
