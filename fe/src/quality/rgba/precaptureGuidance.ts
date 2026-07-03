import type { Quad } from "../../documentScanner";
import { polygonArea } from "../../detection/geometry";
import { warpOutputSize } from "../../warp/homography";
import { DEFAULT_QUALITY_CONFIG, type QualityConfig } from "../config";
import { computeEdgeMetrics } from "../metrics/perspective";
import { scorePerspective } from "../scoring/perspective";
import { scoreResolution } from "../scoring/resolution";

export interface PrecaptureGuidance {
  /** Perspective score (0-100) of the live quad. */
  perspectiveScore: number;
  /** Estimated captured document width in source pixels. */
  resolutionWidth: number;
  /** Resolution score (0-100) derived from the captured width. */
  resolutionScore: number;
  /** Share of the camera frame covered by the detected document (0–1), when frame size is known. */
  frameFill: number | null;
  /** Short, actionable hints — angle and "move closer" only. */
  hints: string[];
}

export interface PrecaptureFrame {
  width: number;
  height: number;
}

export const HINT_HOLD_FLATTER = "紙の真上から、スマホを水平に構えてください。";
export const HINT_MOVE_CLOSER = "もう少しカメラを近づけると、文字がはっきり写ります。";

/**
 * Lightweight, geometry-only guidance for the live preview. Focuses the user on
 * the two levers they control before capture: shooting angle (perspective) and
 * distance / detail (captured resolution). Cheap enough to run every detection
 * cycle since it touches no pixels.
 */
export function precaptureGuidance(
  quad: Quad,
  config: QualityConfig = DEFAULT_QUALITY_CONFIG,
  sourceFrame?: PrecaptureFrame,
): PrecaptureGuidance {
  const perspective = scorePerspective(computeEdgeMetrics(quad), config.perspective);
  const { width } = warpOutputSize(quad, 0);
  const resolution = scoreResolution({ width, height: width }, config.resolution);

  const frameFill =
    sourceFrame && sourceFrame.width > 0 && sourceFrame.height > 0
      ? polygonArea(quad) / (sourceFrame.width * sourceFrame.height)
      : null;

  const hints: string[] = [];
  if (perspective.perspectiveScore < config.guidance.weakScoreThreshold) {
    hints.push(HINT_HOLD_FLATTER);
  }
  const tooLittleDetail =
    resolution.resolutionScore < config.guidance.weakScoreThreshold ||
    (frameFill !== null && frameFill < config.guidance.minFrameFill);
  if (tooLittleDetail) {
    hints.push(HINT_MOVE_CLOSER);
  }

  return {
    perspectiveScore: perspective.perspectiveScore,
    resolutionWidth: width,
    resolutionScore: resolution.resolutionScore,
    frameFill,
    hints,
  };
}
