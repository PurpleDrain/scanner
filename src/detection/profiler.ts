import type { StageTimings } from "./types";

/** Minimal stage timer (spec section 9). Accumulates per-stage milliseconds across the pipeline. */
export class Profiler {
  private readonly timings: StageTimings = {};

  private now(): number {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
  }

  measure<T>(stage: string, fn: () => T): T {
    const start = this.now();
    const result = fn();
    this.timings[stage] = (this.timings[stage] ?? 0) + (this.now() - start);
    return result;
  }

  get(): StageTimings {
    return { ...this.timings };
  }
}
