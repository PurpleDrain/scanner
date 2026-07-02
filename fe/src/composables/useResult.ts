import { ref } from "vue";
import type { Quad } from "../documentScanner";
import { warpRgba } from "../warp/webglWarp";
import { analyzeQualityRgba } from "../quality/rgba/analyzeQualityRgba";
import type { DocumentQualityResult } from "../quality/types";

const EXPORT_MIN_DOCUMENT_WIDTH = 2400;

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

export function useResult() {
  const lastQuality = ref<DocumentQualityResult | null>(null);
  const lastFlattenedSize = ref<{ width: number; height: number } | null>(null);

  async function flattenFromEditor(
    still: { canvas: HTMLCanvasElement; width: number; height: number },
    quad: Quad,
    processing: { beginProcessing: (msg: string) => void; endProcessing: () => void },
  ): Promise<{ data: Uint8ClampedArray; width: number; height: number } | null> {
    processing.beginProcessing("Flattening…");
    try {
      await yieldToUi();
      const { canvas, width, height } = still;
      const srcData = canvas.getContext("2d")!.getImageData(0, 0, width, height).data;

      const nativeWarp = warpRgba(srcData, width, height, quad, {});
      const exportWarp = warpRgba(srcData, width, height, quad, { minOutputWidth: EXPORT_MIN_DOCUMENT_WIDTH });

      lastQuality.value = analyzeQualityRgba(nativeWarp.data, nativeWarp.width, nativeWarp.height, quad, undefined, {
        data: srcData,
        width,
        height,
      });
      lastFlattenedSize.value = { width: exportWarp.width, height: exportWarp.height };
      return exportWarp;
    } finally {
      processing.endProcessing();
    }
  }

  return { lastQuality, lastFlattenedSize, flattenFromEditor };
}
