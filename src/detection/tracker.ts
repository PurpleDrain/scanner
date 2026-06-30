import { isConvex, orderCorners, polygonArea, scaleQuad } from "./geometry";
import type { DetectionResult, Point, Quad } from "./types";

export type TrackerState = "searching" | "detected" | "tracking" | "lost";

export interface TrackingResult {
  state: TrackerState;
  /** Smoothed quad in detection/source coordinates (null when no document is being tracked). */
  quad: Quad | null;
  /** Raw quad from the most recent detection frame, before smoothing. */
  rawDetectedQuad: Quad | null;
  /** Detection confidence from the most recent detection (0 between detection frames). */
  detectionConfidence: number;
  /** Composite tracking confidence (0..1). Drops when corners jump or detections fail. */
  trackingConfidence: number;
  /** Stability score for auto-capture readiness (0..1). High when stationary and confident. */
  stabilityScore: number;
  /** Mean corner displacement since the previous detection frame (pixels). */
  cornerVelocity: number;
  /**
   * Per-corner 2-D displacement vectors since the previous smoothed position.
   * Each entry is {x, y} = currentCorner − previousCorner. Use these to draw velocity arrows.
   */
  cornerDeltas: readonly [Point, Point, Point, Point] | null;
}

export interface TrackerOptions {
  /** Detection confidence above which to enter the Detected state. */
  detectThreshold?: number;
  /** Tracking confidence below which to enter the Lost state. */
  lostThreshold?: number;
  /** Consecutive high-confidence detection cycles before entering Tracking. */
  framesForTracking?: number;
  /** Detection cycles in Lost before falling back to Searching. */
  maxCyclesLost?: number;
  /** Exponential smoothing alpha for the previous corner at low motion. Higher = smoother. */
  alphaAtLowMotion?: number;
  /** Exponential smoothing alpha for the previous corner at high motion. Lower = more responsive. */
  alphaAtHighMotion?: number;
  /** Mean corner displacement (px) at which smoothing transitions from low-motion to high-motion. */
  motionThreshold?: number;
  /** Maximum mean corner displacement (px) for a new detection to pass the sanity check. */
  maxCornerJump?: number;
  /** Maximum quad area ratio change for a new detection to pass the sanity check. */
  maxAreaRatioChange?: number;
  /** Number of recent corner-displacement samples used to compute the rolling velocity. */
  velocityWindowSize?: number;
}

const DEFAULTS: Required<TrackerOptions> = {
  detectThreshold: 0.5,
  lostThreshold: 0.3,
  framesForTracking: 3,
  maxCyclesLost: 8,
  alphaAtLowMotion: 0.85,
  alphaAtHighMotion: 0.35,
  motionThreshold: 25,
  maxCornerJump: 100,
  maxAreaRatioChange: 2.5,
  velocityWindowSize: 6,
};

/**
 * Temporal tracker for a detected document quad.
 *
 * Call `update()` whenever a fresh `DetectionResult` is available and `tick()` on every
 * other frame (where detection was skipped). Both methods return a `TrackingResult` whose
 * `quad` field is always the exponentially-smoothed output for the UI to display.
 *
 * State machine:
 *   Searching → Detected → Tracking → Lost → Searching
 */
export class DocumentTracker {
  private opts: Required<TrackerOptions>;

  private _state: TrackerState = "searching";
  private _smoothedQuad: Quad | null = null;
  private _rawDetectedQuad: Quad | null = null;
  private _detectionConfidence: number = 0;
  private _trackingConfidence: number = 0;
  private _stabilityScore: number = 0;
  private _cornerVelocity: number = 0;
  private _cornerDeltas: [Point, Point, Point, Point] | null = null;

  private consecutiveGoodCycles: number = 0;
  private cyclesSinceDetection: number = 0;
  private cyclesInLost: number = 0;

  private prevSmoothedQuad: Quad | null = null;
  private velocityHistory: number[] = [];

  constructor(opts: TrackerOptions = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  get state(): TrackerState {
    return this._state;
  }

  /**
   * Process a new detection result. Call this on every frame where full detection ran.
   */
  update(result: DetectionResult): TrackingResult {
    this.cyclesSinceDetection = 0;
    this._detectionConfidence = result.confidence?.value ?? 0;
    this._rawDetectedQuad = result.quad;

    const candidate = this._selectCandidate(result);

    switch (this._state) {
      case "searching":
        this._handleSearching(candidate, this._detectionConfidence);
        break;
      case "detected":
        this._handleDetected(candidate, this._detectionConfidence);
        break;
      case "tracking":
        this._handleTracking(candidate, this._detectionConfidence);
        break;
      case "lost":
        this._handleLost(candidate, this._detectionConfidence);
        break;
    }

    this._updateVelocity();
    this._updateStability();
    return this._result();
  }

  /**
   * Advance one frame without new detection data. Call this on throttled/skipped frames.
   */
  tick(): TrackingResult {
    this.cyclesSinceDetection++;

    if (this._state === "tracking") {
      // Decay confidence slowly between detections; faster if detections have been absent too long.
      const decayRate = this.cyclesSinceDetection > 15 ? 0.96 : 0.995;
      this._trackingConfidence *= decayRate;
      if (this._trackingConfidence < this.opts.lostThreshold) {
        this._enterLost();
      }
    } else if (this._state === "lost") {
      this.cyclesInLost++;
      if (this.cyclesInLost > this.opts.maxCyclesLost) {
        this._enterSearching();
      }
    } else if (this._state === "detected" && this.cyclesSinceDetection > 8) {
      // Waiting too long for confirmation — give up.
      this._enterSearching();
    }

    this._updateVelocity();
    this._updateStability();
    return this._result();
  }

  reset(): void {
    this._enterSearching();
    this._rawDetectedQuad = null;
    this._detectionConfidence = 0;
  }

  // ---------------------------------------------------------------------------
  // State handlers

  private _handleSearching(candidate: Quad | null, detConf: number): void {
    if (candidate && detConf >= this.opts.detectThreshold) {
      this._smoothedQuad = candidate;
      this._trackingConfidence = detConf * 0.6;
      this.consecutiveGoodCycles = 1;
      this._state = "detected";
    }
  }

  private _handleDetected(candidate: Quad | null, detConf: number): void {
    if (candidate && detConf >= this.opts.detectThreshold && this._isSane(candidate)) {
      this._smooth(candidate);
      this._trackingConfidence = this._trackingConfidence * 0.6 + detConf * 0.4;
      this.consecutiveGoodCycles++;
      if (this.consecutiveGoodCycles >= this.opts.framesForTracking) {
        this._state = "tracking";
      }
    } else {
      this._enterSearching();
    }
  }

  private _handleTracking(candidate: Quad | null, detConf: number): void {
    if (candidate && this._isSane(candidate)) {
      this._smooth(candidate);
      const stabilityBonus = Math.max(0, 1 - this._cornerVelocity / 40);
      const target = detConf * 0.6 + stabilityBonus * 0.4;
      this._trackingConfidence = this._trackingConfidence * 0.85 + Math.max(0, Math.min(1, target)) * 0.15;
    } else {
      // Detection failed or quad jumped — penalise confidence.
      this._trackingConfidence *= 0.7;
    }
    if (this._trackingConfidence < this.opts.lostThreshold) {
      this._enterLost();
    }
  }

  private _handleLost(candidate: Quad | null, detConf: number): void {
    if (candidate && detConf >= this.opts.detectThreshold && this._isNearLast(candidate)) {
      this._smooth(candidate);
      this._trackingConfidence = 0.55;
      this.consecutiveGoodCycles = this.opts.framesForTracking;
      this.cyclesInLost = 0;
      this._state = "tracking";
    } else {
      this.cyclesInLost++;
      if (this.cyclesInLost > this.opts.maxCyclesLost) {
        this._enterSearching();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Candidate selection

  /**
   * Pick the detection candidate most compatible with the current tracked quad.
   * Prefers the top-scored candidate; switches to runner-up if it is substantially
   * closer to the tracked position and the winner jumped far — this prevents the
   * tracker from snapping to a different nearby rectangle.
   */
  private _selectCandidate(result: DetectionResult): Quad | null {
    if (!result.quad) return null;
    if (!this._smoothedQuad || this._state === "searching") return result.quad;

    const topDist = meanDist(result.quad, this._smoothedQuad);
    const runnerUp = result.runnerUp;

    if (runnerUp && result.scale > 0) {
      const ruSrc = orderCorners(scaleQuad(runnerUp.corners, 1 / result.scale, 1 / result.scale));
      const ruDist = meanDist(ruSrc, this._smoothedQuad);
      // Use runner-up only when it is clearly closer and the winner jumped suspiciously far.
      if (ruDist < topDist * 0.55 && topDist > this.opts.maxCornerJump * 0.4) {
        return ruSrc;
      }
    }

    return result.quad;
  }

  // ---------------------------------------------------------------------------
  // Smoothing

  private _smooth(newQuad: Quad): void {
    if (!this._smoothedQuad) {
      this._smoothedQuad = newQuad;
      return;
    }

    const motion = meanDist(newQuad, this._smoothedQuad);
    const t = Math.min(1, motion / this.opts.motionThreshold);
    // t=0 (low motion) → use alphaAtLowMotion (high smoothing, stable)
    // t=1 (high motion) → use alphaAtHighMotion (low smoothing, responsive)
    const alpha = this.opts.alphaAtLowMotion * (1 - t) + this.opts.alphaAtHighMotion * t;

    this._smoothedQuad = this._smoothedQuad.map((prev, i) => ({
      x: prev.x * alpha + newQuad[i].x * (1 - alpha),
      y: prev.y * alpha + newQuad[i].y * (1 - alpha),
    })) as Quad;
  }

  // ---------------------------------------------------------------------------
  // Sanity checks

  private _isSane(newQuad: Quad): boolean {
    if (!isConvex(newQuad)) return false;
    if (!this._smoothedQuad) return true;

    if (maxDist(newQuad, this._smoothedQuad) > this.opts.maxCornerJump) return false;

    const newArea = polygonArea(newQuad);
    const oldArea = polygonArea(this._smoothedQuad);
    if (oldArea > 0) {
      const ratio = newArea / oldArea;
      if (ratio > this.opts.maxAreaRatioChange || ratio < 1 / this.opts.maxAreaRatioChange) return false;
    }

    return true;
  }

  private _isNearLast(candidate: Quad): boolean {
    if (!this._smoothedQuad) return true;
    return meanDist(candidate, this._smoothedQuad) < this.opts.maxCornerJump * 1.5;
  }

  // ---------------------------------------------------------------------------
  // Velocity and stability

  private _updateVelocity(): void {
    if (!this._smoothedQuad) {
      this._cornerVelocity = 0;
      this._cornerDeltas = null;
      this.velocityHistory = [];
      this.prevSmoothedQuad = null;
      return;
    }

    if (this.prevSmoothedQuad) {
      const v = meanDist(this._smoothedQuad, this.prevSmoothedQuad);
      this.velocityHistory.push(v);
      if (this.velocityHistory.length > this.opts.velocityWindowSize) this.velocityHistory.shift();
      this._cornerVelocity = this.velocityHistory.reduce((a, b) => a + b, 0) / this.velocityHistory.length;
      this._cornerDeltas = this._smoothedQuad.map((p, i) => ({
        x: p.x - this.prevSmoothedQuad![i].x,
        y: p.y - this.prevSmoothedQuad![i].y,
      })) as [Point, Point, Point, Point];
    }

    this.prevSmoothedQuad = [...this._smoothedQuad] as Quad;
  }

  private _updateStability(): void {
    if (this._state !== "tracking" || !this._smoothedQuad) {
      this._stabilityScore *= 0.92;
      return;
    }
    const velocityFactor = Math.max(0, 1 - this._cornerVelocity / 15);
    const target = velocityFactor * 0.6 + this._trackingConfidence * 0.4;
    this._stabilityScore = this._stabilityScore * 0.93 + Math.max(0, Math.min(1, target)) * 0.07;
  }

  // ---------------------------------------------------------------------------
  // Transitions

  private _enterLost(): void {
    this._state = "lost";
    this.cyclesInLost = 0;
    this.consecutiveGoodCycles = 0;
  }

  private _enterSearching(): void {
    this._state = "searching";
    this._smoothedQuad = null;
    this._trackingConfidence = 0;
    this._stabilityScore = 0;
    this._cornerVelocity = 0;
    this._cornerDeltas = null;
    this.consecutiveGoodCycles = 0;
    this.cyclesInLost = 0;
    this.prevSmoothedQuad = null;
    this.velocityHistory = [];
  }

  private _result(): TrackingResult {
    return {
      state: this._state,
      quad: this._smoothedQuad,
      rawDetectedQuad: this._rawDetectedQuad,
      detectionConfidence: this._detectionConfidence,
      trackingConfidence: this._trackingConfidence,
      stabilityScore: this._stabilityScore,
      cornerVelocity: this._cornerVelocity,
      cornerDeltas: this._cornerDeltas,
    };
  }
}

// ---------------------------------------------------------------------------
// Geometry helpers (operating directly on Quads, not needing imports)

function meanDist(a: Quad, b: Quad): number {
  return (
    (Math.hypot(a[0].x - b[0].x, a[0].y - b[0].y) +
      Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y) +
      Math.hypot(a[2].x - b[2].x, a[2].y - b[2].y) +
      Math.hypot(a[3].x - b[3].x, a[3].y - b[3].y)) /
    4
  );
}

function maxDist(a: Quad, b: Quad): number {
  let m = 0;
  for (let i = 0; i < 4; i++) {
    const d = Math.hypot(a[i].x - b[i].x, a[i].y - b[i].y);
    if (d > m) m = d;
  }
  return m;
}
