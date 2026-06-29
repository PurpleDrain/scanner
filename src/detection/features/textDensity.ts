import type { CV } from "@techstark/opencv-js";
import type { DetectionConfig } from "../config";

/**
 * Text-density feature (spec section 3, interior analysis).
 *
 * Documents contain many small high-frequency structures (glyphs). We adaptively threshold the L
 * channel to isolate dark-on-light marks, find connected components, and keep those whose area
 * falls in a glyph-sized band. The per-cell count of such components, normalised, gives a 0..1
 * "text likelihood" map. A candidate quad that contains lots of text is more likely the document
 * than a featureless background rectangle.
 *
 * Returns a width*height map (nearest-upsampled from the cell grid) for both scoring and debug.
 */
export function computeTextDensity(
  cv: CV,
  labL: Float32Array,
  width: number,
  height: number,
  config: DetectionConfig,
): Float32Array {
  const gray = new cv.Mat(height, width, cv.CV_8UC1);
  const bin = new cv.Mat();
  const labels = new cv.Mat();
  const stats = new cv.Mat();
  const centroids = new cv.Mat();

  try {
    const u8 = new Uint8Array(width * height);
    for (let i = 0; i < u8.length; i++) u8[i] = Math.max(0, Math.min(255, labL[i]));
    gray.data.set(u8);

    const blockSize = config.adaptiveBlockSize % 2 === 0 ? config.adaptiveBlockSize + 1 : config.adaptiveBlockSize;
    cv.adaptiveThreshold(gray, bin, 255, cv.ADAPTIVE_THRESH_MEAN_C, cv.THRESH_BINARY_INV, blockSize, config.adaptiveC);

    const numLabels = cv.connectedComponentsWithStats(bin, labels, stats, centroids, 8, cv.CV_32S);

    const imageArea = width * height;
    const minArea = imageArea * config.textCompMinFraction;
    const maxArea = imageArea * config.textCompMaxFraction;
    const isText = new Uint8Array(numLabels);
    const statsData = stats.data32S; // numLabels × 5, area at col 4 (CC_STAT_AREA)
    for (let label = 1; label < numLabels; label++) {
      const area = statsData[label * 5 + 4];
      if (area >= minArea && area <= maxArea) isText[label] = 1;
    }

    const cells = config.textGridCells;
    const grid = new Float32Array(cells * cells);
    const labelData = labels.data32S;
    for (let y = 0; y < height; y++) {
      const cy = Math.min(cells - 1, Math.floor((y / height) * cells));
      for (let x = 0; x < width; x++) {
        const label = labelData[y * width + x];
        if (label > 0 && isText[label]) {
          const cx = Math.min(cells - 1, Math.floor((x / width) * cells));
          grid[cy * cells + cx] += 1;
        }
      }
    }

    let maxCell = 0;
    for (let i = 0; i < grid.length; i++) if (grid[i] > maxCell) maxCell = grid[i];
    if (maxCell > 0) for (let i = 0; i < grid.length; i++) grid[i] /= maxCell;

    // Nearest-upsample the cell grid to full resolution.
    const density = new Float32Array(width * height);
    for (let y = 0; y < height; y++) {
      const cy = Math.min(cells - 1, Math.floor((y / height) * cells));
      for (let x = 0; x < width; x++) {
        const cx = Math.min(cells - 1, Math.floor((x / width) * cells));
        density[y * width + x] = grid[cy * cells + cx];
      }
    }
    return density;
  } finally {
    gray.delete();
    bin.delete();
    labels.delete();
    stats.delete();
    centroids.delete();
  }
}
