/**
 * Params Overlay Service
 *
 * Manages runtime adjustments to strategy params for fill improvement.
 * The overlay is applied on top of DB params (the Source of Truth) and
 * is memory-only (resets on restart).
 *
 * Responsibilities:
 * - Track last fill time
 * - Compute baseHalfSpreadBps tightening when no fills for extended periods
 * - Generate signature for params comparison (detect content changes)
 * - Provide effectiveParams = dbParams + overlay for order calculation
 */

import type { StrategyParams } from "@agentic-mm-bot/core";
import { logger } from "@agentic-mm-bot/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

export interface ParamsOverlayConfig {
  /** Window (ms) without fills before starting to tighten spread */
  noFillWindowMs: number;
  /** Step to reduce baseHalfSpreadBps per adjustment (bps) */
  tightenStepBps: number;
  /** Minimum baseHalfSpreadBps (floor) */
  minBaseHalfSpreadBps: number;
  /** Minimum interval between tighten adjustments (ms) */
  tightenIntervalMs: number;
}

export const DEFAULT_OVERLAY_CONFIG: ParamsOverlayConfig = {
  noFillWindowMs: 120_000, // 2 minutes
  tightenStepBps: 0.5,
  minBaseHalfSpreadBps: 5,
  tightenIntervalMs: 60_000, // 1 minute
};

// ─────────────────────────────────────────────────────────────────────────────
// Overlay State
// ─────────────────────────────────────────────────────────────────────────────

export interface OverlayState {
  /** Current tightening amount (bps subtracted from db value) */
  tightenBps: number;
  /** Last time we applied a tightening step */
  lastTightenAtMs: number | null;
  /** Last fill timestamp */
  lastFillAtMs: number | null;
  /** Whether overlay is currently active (can be disabled by safety conditions) */
  active: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature Generation (for content-based comparison)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a stable signature from StrategyParams for content comparison.
 * Used to detect when DB params changed even if ID stays the same.
 */
export function computeParamsSignature(params: StrategyParams): string {
  return [
    params.baseHalfSpreadBps,
    params.volSpreadGain,
    params.toxSpreadGain,
    params.quoteSizeUsd,
    String(params.refreshIntervalMs),
    String(params.staleCancelMs),
    params.maxInventory,
    params.inventorySkewGain,
    params.pauseMarkIndexBps,
    String(params.pauseLiqCount10s),
  ].join("|");
}

// ─────────────────────────────────────────────────────────────────────────────
// Params Overlay Manager
// ─────────────────────────────────────────────────────────────────────────────

export class ParamsOverlayManager {
  private readonly config: ParamsOverlayConfig;
  private state: OverlayState;

  constructor(config: Partial<ParamsOverlayConfig> = {}) {
    this.config = { ...DEFAULT_OVERLAY_CONFIG, ...config };
    this.state = {
      tightenBps: 0,
      lastTightenAtMs: null,
      lastFillAtMs: null,
      active: true,
    };
  }

  /**
   * Notify that a fill occurred. Resets tightening.
   */
  onFill(nowMs: number = Date.now()): void {
    this.state.lastFillAtMs = nowMs;

    // Reset tightening on fill (conservative approach)
    if (this.state.tightenBps > 0) {
      logger.debug("Overlay: fill received, resetting tighten", {
        previousTightenBps: this.state.tightenBps,
      });
      this.state.tightenBps = 0;
      this.state.lastTightenAtMs = null;
    }
  }

  /**
   * Enable or disable overlay (e.g., disable during PAUSE, stale data, errors)
   */
  setActive(active: boolean): void {
    if (this.state.active !== active) {
      logger.debug("Overlay: active state changed", { active });
      this.state.active = active;
      if (!active) {
        // Reset tightening when deactivated
        this.state.tightenBps = 0;
        this.state.lastTightenAtMs = null;
      }
    }
  }

  /**
   * Get current overlay state (for dashboard display)
   */
  getState(): Readonly<OverlayState> {
    return { ...this.state };
  }

  /**
   * Compute effective params with overlay applied.
   *
   * @param dbParams - The DB params (Source of Truth)
   * @param nowMs - Current timestamp
   * @returns effectiveParams with adjusted baseHalfSpreadBps
   */
  computeEffectiveParams(dbParams: StrategyParams, nowMs: number = Date.now()): StrategyParams {
    // If overlay is disabled, return db params as-is
    if (!this.state.active) {
      return dbParams;
    }

    // Check if we should apply/increase tightening
    this.maybeAdjustTighten(dbParams, nowMs);

    // Apply tightening to baseHalfSpreadBps
    const dbBase = parseFloat(dbParams.baseHalfSpreadBps);
    if (Number.isNaN(dbBase)) {
      // If baseHalfSpreadBps is not numeric, do not apply overlay.
      return dbParams;
    }

    // Never widen spread beyond DB value.
    // Also, if DB base is already below the configured floor, keep DB value as-is.
    if (dbBase <= this.config.minBaseHalfSpreadBps) {
      return dbParams;
    }

    const tightened = dbBase - this.state.tightenBps;
    const floored = Math.max(this.config.minBaseHalfSpreadBps, tightened);
    const effectiveBase = Math.min(dbBase, floored);

    return {
      ...dbParams,
      baseHalfSpreadBps: String(effectiveBase),
    };
  }

  /**
   * Internal: check if we should tighten spread further
   */
  private maybeAdjustTighten(dbParams: StrategyParams, nowMs: number): void {
    // Don't tighten if we have no reference point
    if (this.state.lastFillAtMs === null) {
      // Initialize lastFillAtMs to now if never set (avoids immediate tightening on startup)
      this.state.lastFillAtMs = nowMs;
      return;
    }

    const timeSinceLastFill = nowMs - this.state.lastFillAtMs;

    // Not enough time without fills yet
    if (timeSinceLastFill < this.config.noFillWindowMs) {
      return;
    }

    // Check interval since last tighten
    if (this.state.lastTightenAtMs !== null) {
      const timeSinceLastTighten = nowMs - this.state.lastTightenAtMs;
      if (timeSinceLastTighten < this.config.tightenIntervalMs) {
        return;
      }
    }

    // Check if we can tighten further (not at floor)
    const dbBase = parseFloat(dbParams.baseHalfSpreadBps);
    const currentEffective = dbBase - this.state.tightenBps;

    if (currentEffective <= this.config.minBaseHalfSpreadBps) {
      // Already at floor
      return;
    }

    // Apply tightening step
    const newTightenBps = Math.min(
      this.state.tightenBps + this.config.tightenStepBps,
      dbBase - this.config.minBaseHalfSpreadBps,
    );

    if (newTightenBps > this.state.tightenBps) {
      logger.info("Overlay: tightening spread due to no fills", {
        timeSinceLastFillMs: timeSinceLastFill,
        previousTightenBps: this.state.tightenBps,
        newTightenBps,
        dbBaseHalfSpreadBps: dbBase,
        effectiveBaseHalfSpreadBps: dbBase - newTightenBps,
      });

      this.state.tightenBps = newTightenBps;
      this.state.lastTightenAtMs = nowMs;
    }
  }

  /**
   * Reset overlay state (e.g., when db params change significantly)
   */
  reset(): void {
    this.state = {
      tightenBps: 0,
      lastTightenAtMs: null,
      lastFillAtMs: null,
      active: true,
    };
    logger.debug("Overlay: state reset");
  }
}
