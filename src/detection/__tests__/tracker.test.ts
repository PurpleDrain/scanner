import { describe, expect, it } from "vitest";
import { DocumentTracker } from "../tracker";
import type { DetectionResult, Quad } from "../types";

// ---------------------------------------------------------------------------
// Helpers

function makeResult(quad: Quad | null, confidence: number): DetectionResult {
  return {
    quad,
    confidence: quad
      ? { value: confidence, edgeStrength: confidence, quadValidity: 1, scoreGap: 0.2, textDensity: 0.5, geometricPlausibility: 1 }
      : null,
    components: quad
      ? {
          edge: 0.8,
          textDensity: 0.5,
          area: 0.7,
          aspectRatio: 1.0,
          interiorConsistency: 0.6,
          envelopeSupport: 0.65,
          borderMargin: 0.6,
          total: 0.7,
        }
      : null,
    runnerUp: null,
    scale: 1,
    mode: "full",
    timings: {},
  };
}

function makeQuad(x: number, y: number, w: number, h: number): Quad {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

const DOC: Quad = makeQuad(50, 40, 200, 280);

// ---------------------------------------------------------------------------

describe("DocumentTracker — state machine", () => {
  it("starts in searching state with no quad", () => {
    const tracker = new DocumentTracker();
    const r = tracker.tick();
    expect(r.state).toBe("searching");
    expect(r.quad).toBeNull();
  });

  it("transitions searching → detected on first confident detection", () => {
    const tracker = new DocumentTracker();
    const r = tracker.update(makeResult(DOC, 0.8));
    expect(r.state).toBe("detected");
    expect(r.quad).not.toBeNull();
  });

  it("stays in searching when confidence is below threshold", () => {
    const tracker = new DocumentTracker();
    const r = tracker.update(makeResult(DOC, 0.3));
    expect(r.state).toBe("searching");
    expect(r.quad).toBeNull();
  });

  it("stays in searching when detection returns null quad", () => {
    const tracker = new DocumentTracker();
    const r = tracker.update(makeResult(null, 0));
    expect(r.state).toBe("searching");
    expect(r.quad).toBeNull();
  });

  it("transitions detected → tracking after framesForTracking consecutive detections", () => {
    const tracker = new DocumentTracker({ framesForTracking: 3 });
    tracker.update(makeResult(DOC, 0.85));
    tracker.update(makeResult(DOC, 0.85));
    const r = tracker.update(makeResult(DOC, 0.85));
    expect(r.state).toBe("tracking");
  });

  it("resets from detected → searching after repeated detection failures", () => {
    const tracker = new DocumentTracker({ framesForTracking: 3, maxBadDetectionCycles: 2 });
    tracker.update(makeResult(DOC, 0.85));
    tracker.update(makeResult(null, 0));
    expect(tracker.state).toBe("detected");
    const r = tracker.update(makeResult(null, 0));
    expect(r.state).toBe("searching");
    expect(r.quad).toBeNull();
  });

  it("transitions tracking → lost when tracking confidence decays", () => {
    // maxCyclesLost=3 so after 3 bad detection cycles in "lost", it enters "searching"
    // We just need to confirm the tracker eventually leaves "tracking" on repeated failures.
    const tracker = new DocumentTracker({ framesForTracking: 2, lostThreshold: 0.3, maxCyclesLost: 3 });
    tracker.update(makeResult(DOC, 0.9));
    tracker.update(makeResult(DOC, 0.9));
    expect(tracker.state).toBe("tracking");

    for (let i = 0; i < 3; i++) tracker.update(makeResult(null, 0));
    // Should have left "tracking"; may be "lost" or "searching" depending on confidence
    expect(tracker.state).not.toBe("tracking");
  });

  it("recovers lost → tracking when a near detection arrives", () => {
    // Use a large maxCyclesLost so the tracker stays in "lost" while we test recovery.
    const tracker = new DocumentTracker({ framesForTracking: 2, lostThreshold: 0.3, maxCyclesLost: 20 });
    tracker.update(makeResult(DOC, 0.9));
    tracker.update(makeResult(DOC, 0.9));
    // Knock into lost: 3 bad updates cause trackingConfidence to drop below lostThreshold
    for (let i = 0; i < 3; i++) tracker.update(makeResult(null, 0));
    expect(tracker.state).toBe("lost");

    // Recovery with same quad at same position
    const r = tracker.update(makeResult(DOC, 0.8));
    expect(r.state).toBe("tracking");
  });

  it("falls from lost → searching after maxCyclesLost", () => {
    const tracker = new DocumentTracker({ framesForTracking: 2, lostThreshold: 0.3, maxCyclesLost: 3 });
    tracker.update(makeResult(DOC, 0.9));
    tracker.update(makeResult(DOC, 0.9));
    // Exhaust tracking confidence to enter "lost", then exhaust maxCyclesLost
    for (let i = 0; i < 10; i++) tracker.update(makeResult(null, 0));
    expect(tracker.state).toBe("searching");
    expect(tracker.update(makeResult(null, 0)).quad).toBeNull();
  });

  it("tick() counts between detections and can trigger lost", () => {
    const tracker = new DocumentTracker({ framesForTracking: 2, lostThreshold: 0.3, maxCyclesLost: 2 });
    tracker.update(makeResult(DOC, 0.9));
    tracker.update(makeResult(DOC, 0.9));
    expect(tracker.state).toBe("tracking");

    // Tick many times without detection
    for (let i = 0; i < 60; i++) tracker.tick();
    expect(["lost", "searching"]).toContain(tracker.state);
  });
});

describe("DocumentTracker — smoothing", () => {
  it("smoothed quad does not jump immediately to a new position", () => {
    const tracker = new DocumentTracker({ framesForTracking: 2, alphaAtLowMotion: 0.85 });
    tracker.update(makeResult(DOC, 0.9));
    tracker.update(makeResult(DOC, 0.9));

    // Now move the detection 100px to the right
    const shifted = makeQuad(150, 40, 200, 280);
    const r = tracker.update(makeResult(shifted, 0.9));

    // Smoothed quad should be between DOC and shifted
    const tl = r.quad![0];
    expect(tl.x).toBeGreaterThan(DOC[0].x);
    expect(tl.x).toBeLessThan(shifted[0].x);
  });

  it("adapts faster at high motion than low motion", () => {
    const tracker = new DocumentTracker({
      framesForTracking: 2,
      alphaAtLowMotion: 0.85,
      alphaAtHighMotion: 0.35,
      motionThreshold: 20,
    });
    tracker.update(makeResult(DOC, 0.9));
    tracker.update(makeResult(DOC, 0.9));

    // Small shift (low motion)
    const smallShift = makeQuad(55, 40, 200, 280);
    const rLow = tracker.update(makeResult(smallShift, 0.9));
    const lowDelta = rLow.quad![0].x - DOC[0].x;

    // Reset and re-enter tracking
    tracker.reset();
    tracker.update(makeResult(DOC, 0.9));
    tracker.update(makeResult(DOC, 0.9));

    // Large shift (high motion)
    const bigShift = makeQuad(150, 40, 200, 280);
    const rHigh = tracker.update(makeResult(bigShift, 0.9));
    const highDelta = rHigh.quad![0].x - DOC[0].x;

    expect(highDelta).toBeGreaterThan(lowDelta);
  });

  it("smooths small jitter more once stability is high", () => {
    const tracker = new DocumentTracker({
      framesForTracking: 2,
      stableSmoothingThreshold: 0.4,
      alphaWhenStable: 0.95,
      alphaAtLowMotion: 0.7,
      largeChangeMotionThreshold: 200,
      captureReadyStability: 0.5,
      stabilityBlend: 0.2,
    });
    tracker.update(makeResult(DOC, 0.9));
    tracker.update(makeResult(DOC, 0.9));
    for (let i = 0; i < 25; i++) tracker.update(makeResult(DOC, 0.9));
    expect(tracker.update(makeResult(DOC, 0.9)).stabilityScore).toBeGreaterThanOrEqual(0.4);

    const jitter = makeQuad(58, 40, 200, 280);
    const r = tracker.update(makeResult(jitter, 0.9));
    expect(r.quad![0].x).toBeLessThan(55);
  });
});

describe("DocumentTracker — geometric sanity", () => {
  it("rejects self-intersecting (bowtie) quads", () => {
    const tracker = new DocumentTracker({ framesForTracking: 2 });
    tracker.update(makeResult(DOC, 0.9));
    tracker.update(makeResult(DOC, 0.9));
    expect(tracker.state).toBe("tracking");

    const bowtie: Quad = [
      { x: 50, y: 40 },
      { x: 250, y: 320 }, // swapped corners
      { x: 250, y: 40 },
      { x: 50, y: 320 },
    ];
    tracker.update(makeResult(bowtie, 0.9));
    // Tracking confidence should have dropped
    const r = tracker.update(makeResult(bowtie, 0.9));
    expect(r.trackingConfidence).toBeLessThan(0.9);
  });

  it("rejects a moderate jump that exceeds maxCornerJump but is not a large deliberate move", () => {
    const tracker = new DocumentTracker({
      framesForTracking: 2,
      maxCornerJump: 30,
      largeChangeMotionThreshold: 80,
    });
    tracker.update(makeResult(DOC, 0.9));
    tracker.update(makeResult(DOC, 0.9));

    const mediumJump = makeQuad(120, 40, 200, 280);
    tracker.update(makeResult(mediumJump, 0.9));
    const r = tracker.update(makeResult(mediumJump, 0.9));
    expect(r.trackingConfidence).toBeLessThan(0.8);
  });

  it("follows a deliberate large reposition quickly", () => {
    const tracker = new DocumentTracker({
      framesForTracking: 2,
      maxCornerJump: 30,
      largeChangeMotionThreshold: 80,
      alphaOnLargeChange: 0.15,
    });
    tracker.update(makeResult(DOC, 0.9));
    tracker.update(makeResult(DOC, 0.9));
    for (let i = 0; i < 20; i++) tracker.update(makeResult(DOC, 0.9));

    const farAway = makeQuad(500, 500, 200, 280);
    const r = tracker.update(makeResult(farAway, 0.9));
    expect(r.trackingConfidence).toBeGreaterThanOrEqual(0.5);
    expect(r.quad![0].x).toBeGreaterThan(300);
  });
});

describe("DocumentTracker — stability score", () => {
  it("builds stability score while tracking a stationary document", () => {
    const tracker = new DocumentTracker({ framesForTracking: 2 });
    tracker.update(makeResult(DOC, 0.9));
    tracker.update(makeResult(DOC, 0.9));

    // Feed many identical detections
    for (let i = 0; i < 30; i++) tracker.update(makeResult(DOC, 0.9));

    expect(tracker.update(makeResult(DOC, 0.9)).stabilityScore).toBeGreaterThan(0.3);
  });

  it("stability decreases during searching/lost state", () => {
    const tracker = new DocumentTracker({ framesForTracking: 2 });
    tracker.update(makeResult(DOC, 0.9));
    tracker.update(makeResult(DOC, 0.9));
    for (let i = 0; i < 20; i++) tracker.update(makeResult(DOC, 0.9));

    const peak = tracker.update(makeResult(DOC, 0.9)).stabilityScore;
    tracker.reset();
    for (let i = 0; i < 10; i++) tracker.tick();

    expect(tracker.tick().stabilityScore).toBeLessThan(peak);
  });
});

describe("DocumentTracker — corner velocity", () => {
  it("reports zero velocity when quad is stationary", () => {
    const tracker = new DocumentTracker({ framesForTracking: 2 });
    tracker.update(makeResult(DOC, 0.9));
    tracker.update(makeResult(DOC, 0.9));
    for (let i = 0; i < 5; i++) tracker.update(makeResult(DOC, 0.9));
    expect(tracker.update(makeResult(DOC, 0.9)).cornerVelocity).toBeCloseTo(0, 1);
  });

  it("reports non-zero velocity when quad is moving", () => {
    const tracker = new DocumentTracker({ framesForTracking: 2 });
    tracker.update(makeResult(DOC, 0.9));
    tracker.update(makeResult(DOC, 0.9));
    // Feed detections with gradually shifting quad
    for (let i = 0; i < 6; i++) {
      tracker.update(makeResult(makeQuad(50 + i * 5, 40, 200, 280), 0.9));
    }
    expect(tracker.update(makeResult(makeQuad(50 + 7 * 5, 40, 200, 280), 0.9)).cornerVelocity).toBeGreaterThan(0);
  });
});

describe("DocumentTracker — candidate association", () => {
  it("prefers runner-up when it is much closer to tracked position than the winner", () => {
    const tracker = new DocumentTracker({ framesForTracking: 2 });
    tracker.update(makeResult(DOC, 0.9));
    tracker.update(makeResult(DOC, 0.9));
    expect(tracker.state).toBe("tracking");

    // Winner is far away; runner-up (in feature coords at scale 1) is close
    const farWinner = makeQuad(400, 400, 150, 200);
    const closeRunnerUp = makeQuad(55, 42, 198, 276); // slightly shifted DOC

    const resultWithRunnerUp: DetectionResult = {
      quad: farWinner,
      confidence: { value: 0.85, edgeStrength: 0.8, quadValidity: 1, scoreGap: 0.1, textDensity: 0.5, geometricPlausibility: 1 },
      components: {
        edge: 0.8,
        textDensity: 0.5,
        area: 0.7,
        aspectRatio: 1.0,
        interiorConsistency: 0.6,
        envelopeSupport: 0.65,
        borderMargin: 0.6,
        total: 0.7,
      },
      runnerUp: {
        corners: closeRunnerUp, // scale=1 → feature == source coords
        lines: [] as any,
        components: {
          edge: 0.7,
          textDensity: 0.5,
          area: 0.65,
          aspectRatio: 1.0,
          interiorConsistency: 0.5,
          envelopeSupport: 0.55,
          borderMargin: 0.5,
          total: 0.65,
        },
        score: 0.65,
      },
      scale: 1,
      mode: "full",
      timings: {},
    };

    const r = tracker.update(resultWithRunnerUp);
    // Smoothed quad should have stayed near DOC, not jumped to farWinner
    expect(r.quad![0].x).toBeLessThan(200);
  });
});

describe("DocumentTracker — reset", () => {
  it("clears all state on reset()", () => {
    const tracker = new DocumentTracker({ framesForTracking: 2 });
    tracker.update(makeResult(DOC, 0.9));
    tracker.update(makeResult(DOC, 0.9));
    expect(tracker.state).toBe("tracking");

    tracker.reset();
    const r = tracker.tick();
    expect(r.state).toBe("searching");
    expect(r.quad).toBeNull();
    expect(r.trackingConfidence).toBe(0);
    expect(r.stabilityScore).toBe(0);
  });
});
