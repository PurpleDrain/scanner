import type { Mat as CvMat } from "@techstark/opencv-js";
import type { ResolutionMetric } from "../types";

/**
 * Reads the corrected (post-perspective-warp) document's pixel dimensions.
 * Kept as its own measurement step — rather than inlined into scoring — so a
 * future revision can add e.g. an estimated-DPI calculation (using a known
 * physical page size) without touching the scoring logic.
 */
export function computeResolutionMetric(corrected: CvMat): ResolutionMetric {
  return { width: corrected.cols, height: corrected.rows };
}
