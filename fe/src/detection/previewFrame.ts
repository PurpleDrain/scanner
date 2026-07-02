/** Max longest side for live preview detection (speed over precision). */
export const PREVIEW_DETECT_MAX_DIM = 480;
/** Max longest side for capture/upload detection — higher input improves corner placement. */
export const CAPTURE_DETECT_MAX_DIM = 1920;

export function previewDetectDimensions(
  srcWidth: number,
  srcHeight: number,
  maxDim = PREVIEW_DETECT_MAX_DIM,
): { width: number; height: number; toSourceScale: number } {
  if (maxDim <= 0 || maxDim >= Math.max(srcWidth, srcHeight)) {
    return { width: srcWidth, height: srcHeight, toSourceScale: 1 };
  }
  const scale = Math.min(1, maxDim / Math.max(srcWidth, srcHeight));
  return {
    width: Math.max(1, Math.round(srcWidth * scale)),
    height: Math.max(1, Math.round(srcHeight * scale)),
    toSourceScale: 1 / scale,
  };
}

/** Downscale a frame to preview detection size and return RGBA pixels. */
export function capturePreviewRgba(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  source: CanvasImageSource,
  srcWidth: number,
  srcHeight: number,
  maxDim = PREVIEW_DETECT_MAX_DIM,
): { width: number; height: number; data: Uint8ClampedArray; toSourceScale: number } {
  const { width, height, toSourceScale } = previewDetectDimensions(srcWidth, srcHeight, maxDim);
  canvas.width = width;
  canvas.height = height;
  ctx.drawImage(source, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  return { width, height, data: imageData.data, toSourceScale };
}
