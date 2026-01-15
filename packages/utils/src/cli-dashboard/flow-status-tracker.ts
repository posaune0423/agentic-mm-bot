export interface PhaseSnapshot<TPhase extends string> {
  phase: TPhase;
  sinceMs: number;
  lastTransitionMs: number;
  lastDurationMs?: number;
}

/**
 * Tracks an application's current "phase" and basic transition timing.
 *
 * - Hot-path friendly: O(1) updates, no allocations beyond trivial objects.
 * - Same-phase updates are treated as no-ops (avoids noisy "transitions").
 */
export class FlowStatusTracker<TPhase extends string> {
  private current: TPhase;
  private sinceMs: number;
  private lastTransitionMs: number;
  private lastDurationMs?: number;

  constructor(initialPhase: TPhase, nowMs: number) {
    this.current = initialPhase;
    this.sinceMs = nowMs;
    this.lastTransitionMs = nowMs;
  }

  enterPhase(phase: TPhase, nowMs: number): void {
    if (phase === this.current) return;

    this.lastDurationMs = Math.max(0, nowMs - this.sinceMs);
    this.current = phase;
    this.sinceMs = nowMs;
    this.lastTransitionMs = nowMs;
  }

  snapshot(): PhaseSnapshot<TPhase> {
    return {
      phase: this.current,
      sinceMs: this.sinceMs,
      lastTransitionMs: this.lastTransitionMs,
      lastDurationMs: this.lastDurationMs,
    };
  }
}
