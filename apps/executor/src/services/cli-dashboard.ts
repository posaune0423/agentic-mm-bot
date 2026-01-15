/**
 * Executor CLI Dashboard (TTY UI)
 *
 * Goal: From a single terminal screen, always know:
 * - Current market prices (BBO/mid/spread, mark/index) and data age
 * - Current strategy mode + latest decision (reason codes, intents, target quote)
 * - What orders are currently live (price/size/age) vs target quote
 * - Recent actions (place/cancel/cancel_all, fills, rejects)
 */
import type { DecideOutput, Features, Snapshot, StrategyParams, StrategyState } from "@agentic-mm-bot/core";
import type { ExecutionEvent } from "@agentic-mm-bot/adapters";
import {
  BOX,
  createDashboardControl,
  FlowStatusTracker,
  LayoutPolicy,
  LogBuffer,
  LogLevel,
  logger,
  Style,
  TTYRenderer,
  TTYScreen,
} from "@agentic-mm-bot/utils";
import type { LogRecord } from "@agentic-mm-bot/utils";

import type { TrackedOrder } from "./order-tracker";
import type { ExecutionAction } from "./execution-planner";
import type { OverlayState } from "./params-overlay";

type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";
type ExecutorPhase = "IDLE" | "READ" | "DECIDE" | "PLAN" | "EXECUTE" | "PERSIST";

/** Position data for realtime display (updated on fills) */
export interface PositionData {
  size: string;
  entryPrice?: string;
  unrealizedPnl?: string;
  lastUpdateMs: number;
}

export interface TickDebug {
  nowMs: number;
  snapshot: Snapshot;
  features: Features;
  output: DecideOutput;
  stateBefore: StrategyState;
  stateAfter: StrategyState;
  paramsSetId: string;
  /** Original DB params (Source of Truth) */
  dbParams: StrategyParams;
  /** Effective params with overlay applied (used for order calculation) */
  effectiveParams: StrategyParams;
  /** Overlay state for display */
  overlayState: OverlayState;
  position: {
    size: string;
    entryPrice?: string;
    unrealizedPnl?: string;
    lastUpdateMs: number;
  };
  orders: TrackedOrder[];
  targetQuote?: { bidPx: string; askPx: string; size: string };
  plannedActions: ExecutionAction[];
  /** Funding rate for display */
  funding?: { rate?: string; tsMs?: number };
}

/** Format number with optional digits, "-" for missing values */
function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return n.toFixed(digits);
}

/** Format price with consistent width */
function fmtPrice(px: string | null | undefined, width = 10): string {
  if (px === null || px === undefined || px === "") return "-".padStart(width);
  return px.padStart(width);
}

/** Format size with consistent width */
function fmtSize(sz: string | null | undefined, width = 8): string {
  if (sz === null || sz === undefined || sz === "") return "-".padStart(width);
  return sz.padStart(width);
}

/** Params change notification for display */
export interface ParamsChangeNotification {
  source: "db_refresh" | "proposal_apply" | "proposal_reject";
  changedAt: number;
  paramsSetId?: string;
  changedKeys?: string[];
  rejectReason?: string;
}

export class ExecutorCliDashboard {
  private readonly enabled: boolean;
  private readonly exchange: string;
  private readonly symbol: string;
  private readonly refreshMs: number;

  private interval: ReturnType<typeof setInterval> | null = null;

  private conn: ConnectionStatus = "connecting";
  private connReason?: string;

  private tick?: TickDebug;

  /** Realtime position data (updated immediately on fills) */
  private realtimePosition?: PositionData;

  /** Last params change notification (for highlighted display) */
  private lastParamsChange?: ParamsChangeNotification;

  /** How long to highlight params change (ms) */
  private readonly paramsChangeHighlightMs = 30_000;

  private readonly style: Style;
  private readonly layout: LayoutPolicy;
  private readonly screen: TTYScreen;
  private readonly renderer: TTYRenderer;
  private readonly logs: LogBuffer;
  private readonly flow: FlowStatusTracker<ExecutorPhase>;

  constructor(args: { enabled: boolean; exchange: string; symbol: string; refreshMs?: number; maxLogs?: number }) {
    const control = createDashboardControl({
      enabled: args.enabled,
      refreshMs: args.refreshMs ?? 250,
      isTTY: process.stdout.isTTY,
    });
    const cfg = control.config();

    this.enabled = cfg.enabled;
    this.exchange = args.exchange;
    this.symbol = args.symbol;

    this.refreshMs = cfg.refreshMs;

    this.style = new Style();
    this.layout = new LayoutPolicy();
    this.renderer = new TTYRenderer(chunk => process.stdout.write(chunk));
    this.screen = new TTYScreen({
      enabled: this.enabled,
      write: chunk => process.stdout.write(chunk),
    });
    this.logs = new LogBuffer(args.maxLogs ?? 300);
    this.flow = new FlowStatusTracker<ExecutorPhase>("IDLE", Date.now());
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  start(): void {
    if (!this.enabled || this.interval) return;
    this.screen.start();
    this.renderer.reset();
    logger.setSink({
      write: r => {
        this.logs.push(r);
      },
    });

    this.interval = setInterval(() => {
      this.render();
    }, this.refreshMs);
  }

  stop(): void {
    if (!this.enabled) return;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    logger.clearSink();
    this.screen.stop();
  }

  setConnectionStatus(status: ConnectionStatus, reason?: string): void {
    this.conn = status;
    this.connReason = reason;
    const level = status === "disconnected" ? LogLevel.WARN : LogLevel.INFO;
    this.pushEvent(level, `market data: ${status}`, reason !== undefined && reason !== "" ? { reason } : undefined);
  }

  enterPhase(phase: ExecutorPhase, nowMs = Date.now()): void {
    this.flow.enterPhase(phase, nowMs);
  }

  setTick(tick: TickDebug): void {
    this.tick = tick;
  }

  /**
   * Update position data in realtime (call on fills for immediate UI update)
   */
  setPosition(position: PositionData): void {
    this.realtimePosition = position;
  }

  /**
   * Notify about params change (for highlighted display in STRATEGY section)
   */
  notifyParamsChange(notification: Omit<ParamsChangeNotification, "changedAt">): void {
    this.lastParamsChange = {
      ...notification,
      changedAt: Date.now(),
    };

    // Also push to event log
    const level = notification.source === "proposal_reject" ? LogLevel.WARN : LogLevel.INFO;
    const sourceLabel =
      notification.source === "db_refresh" ? "DB refresh"
      : notification.source === "proposal_apply" ? "proposal apply"
      : "proposal reject";

    let message = `PARAMS ${sourceLabel}`;
    if (notification.paramsSetId !== undefined && notification.paramsSetId !== "") {
      message += ` id=${notification.paramsSetId.slice(0, 8)}...`;
    }
    if (notification.changedKeys !== undefined && notification.changedKeys.length > 0) {
      message += ` keys=[${notification.changedKeys.join(",")}]`;
    }
    if (notification.rejectReason !== undefined && notification.rejectReason !== "") {
      message += ` reason=${notification.rejectReason}`;
    }

    this.pushEvent(level, message);
  }

  onExecutionEvent(event: ExecutionEvent): void {
    if (event.type === "fill") {
      this.pushEvent(
        LogLevel.INFO,
        `FILL ${event.side} px=${event.price} sz=${event.size} ${event.liquidity ?? ""}`.trim(),
        {
          exchangeOrderId: event.exchangeOrderId,
        },
      );
      return;
    }
    this.pushEvent(
      event.status === "rejected" ? LogLevel.WARN : LogLevel.INFO,
      `ORDER ${event.status} clientId=${event.clientOrderId}${event.reason !== undefined && event.reason !== "" ? ` reason=${event.reason}` : ""}`,
      { exchangeOrderId: event.exchangeOrderId },
    );
  }

  onAction(phase: "start" | "ok" | "err", action: ExecutionAction, extra?: { error?: unknown }): void {
    const msg =
      action.type === "cancel_all" ? "CANCEL_ALL"
      : action.type === "cancel" ? `CANCEL ${action.clientOrderId}`
      : `PLACE ${action.side} px=${action.price} sz=${action.size}`;
    const lvl = phase === "err" ? LogLevel.ERROR : LogLevel.INFO;
    this.pushEvent(lvl, `${phase.toUpperCase()} ${msg}`, extra);
  }

  pushEvent(level: LogLevel, message: string, data?: unknown): void {
    const fields =
      data !== null && data !== undefined && typeof data === "object" ?
        Object.fromEntries(Object.entries(data as Record<string, unknown>).map(([k, v]) => [k, JSON.stringify(v)]))
      : undefined;
    const r: LogRecord = { tsMs: Date.now(), level, message, fields };
    this.logs.push(r);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Rich Render Implementation
  // ─────────────────────────────────────────────────────────────────────────────

  private render(): void {
    if (!this.enabled) return;
    const nowMs = Date.now();
    const W = Math.min(this.layout.getTerminalWidth(), 140); // Cap width for readability

    const lines: string[] = [];

    // ═══════════════════════════════════════════════════════════════════════════
    // HEADER SECTION
    // ═══════════════════════════════════════════════════════════════════════════
    lines.push(...this.renderHeader(nowMs, W));

    // ═══════════════════════════════════════════════════════════════════════════
    // MARKET DATA SECTION
    // ═══════════════════════════════════════════════════════════════════════════
    lines.push(...this.renderMarketSection(nowMs, W));

    // ═══════════════════════════════════════════════════════════════════════════
    // STRATEGY & PARAMS SECTION
    // ═══════════════════════════════════════════════════════════════════════════
    lines.push(...this.renderStrategySection(nowMs, W));

    // ═══════════════════════════════════════════════════════════════════════════
    // ORDERS SECTION
    // ═══════════════════════════════════════════════════════════════════════════
    lines.push(...this.renderOrdersSection(nowMs, W));

    // ═══════════════════════════════════════════════════════════════════════════
    // LOGS SECTION
    // ═══════════════════════════════════════════════════════════════════════════
    lines.push(...this.renderLogsSection(W));

    this.renderer.render(lines);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Header Section
  // ─────────────────────────────────────────────────────────────────────────────

  private renderHeader(nowMs: number, width: number): string[] {
    const lines: string[] = [];

    // Title line with exchange/symbol
    const title = this.style.wrap("EXECUTOR DASHBOARD", "bold", "white");
    const symbol = this.style.wrap(`${this.exchange}/${this.symbol}`, "bold", "cyan");

    // Connection status badge
    const connBadge = this.renderConnectionBadge();

    // Uptime
    const uptime = this.layout.formatDurationMs(Math.floor(process.uptime() * 1000));
    const uptimeLabel = `${this.style.token("dim")}uptime${this.style.token("reset")} ${uptime}`;

    // Flow phase badge
    const flowSnap = this.flow.snapshot();
    const phaseBadge = this.renderPhaseBadge(flowSnap.phase);
    const phaseDur =
      flowSnap.lastDurationMs !== undefined ?
        `${this.style.token("dim")}${String(flowSnap.lastDurationMs)}ms${this.style.token("reset")}`
      : "";

    // Top border
    lines.push(this.layout.sectionHeader(title, width));

    // Content row 1: Symbol | Connection | Uptime
    const row1 = `${symbol}  ${connBadge}  ${uptimeLabel}`;
    lines.push(this.boxRow(row1, width));

    // Content row 2: Phase
    const row2 = `${this.style.token("dim")}Phase:${this.style.token("reset")} ${phaseBadge} ${phaseDur}`;
    lines.push(this.boxRow(row2, width));

    // Bottom border
    lines.push(this.layout.boxLine(width, "middle"));

    return lines;
  }

  private renderConnectionBadge(): string {
    switch (this.conn) {
      case "connected":
        return this.style.badge("CONNECTED", "bgGreen", "white", "bold");
      case "reconnecting":
        return this.style.badge("RECONNECTING", "bgYellow", "white", "bold");
      case "connecting":
        return this.style.badge("CONNECTING", "bgCyan", "white");
      case "disconnected":
        return this.style.badge("DISCONNECTED", "bgRed", "white", "bold");
    }
  }

  private renderPhaseBadge(phase: ExecutorPhase): string {
    switch (phase) {
      case "EXECUTE":
        return this.style.wrap(phase, "bold", "magenta");
      case "DECIDE":
        return this.style.wrap(phase, "bold", "cyan");
      case "PLAN":
        return this.style.wrap(phase, "bold", "yellow");
      case "PERSIST":
        return this.style.wrap(phase, "bold", "blue");
      case "IDLE":
        return this.style.wrap(phase, "dim");
      case "READ":
        return this.style.wrap(phase, "bold", "green");
      default:
        return this.style.wrap(phase, "dim");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Market Data Section
  // ─────────────────────────────────────────────────────────────────────────────

  private renderMarketSection(nowMs: number, width: number): string[] {
    const lines: string[] = [];
    const t = this.tick;

    const sectionTitle = this.style.wrap("MARKET", "bold", "blue");
    lines.push(this.layout.sectionHeader(sectionTitle, width));

    if (!t) {
      lines.push(this.boxRow(`${this.style.token("dim")}No market data${this.style.token("reset")}`, width));
      lines.push(this.layout.boxLine(width, "middle"));
      return lines;
    }

    const bid = Number.parseFloat(t.snapshot.bestBidPx);
    const ask = Number.parseFloat(t.snapshot.bestAskPx);
    const mid = (bid + ask) / 2;
    const spreadBps = mid > 0 ? ((ask - bid) / mid) * 10000 : null;
    const dataAge = this.layout.formatAgeMs(t.nowMs, t.snapshot.lastUpdateMs);

    // BBO Row with colors
    const bidLabel = this.style.wrap("BID", "bold", "green");
    const askLabel = this.style.wrap("ASK", "bold", "red");
    const bidPx = this.style.wrap(fmtPrice(t.snapshot.bestBidPx), "green");
    const askPx = this.style.wrap(fmtPrice(t.snapshot.bestAskPx), "red");
    const bidSz = this.style.wrap(fmtSize(t.snapshot.bestBidSz), "dim");
    const askSz = this.style.wrap(fmtSize(t.snapshot.bestAskSz), "dim");

    const bboRow = `${bidLabel} ${bidPx} × ${bidSz}    ${askLabel} ${askPx} × ${askSz}`;
    lines.push(this.boxRow(bboRow, width));

    // Mid/Spread Row
    const midLabel = `${this.style.token("dim")}Mid:${this.style.token("reset")}`;
    const midVal = this.style.wrap(fmtNum(mid, 2), "bold", "white");
    const spreadLabel = `${this.style.token("dim")}Spread:${this.style.token("reset")}`;
    const spreadVal =
      spreadBps !== null && spreadBps > 10 ?
        this.style.wrap(`${fmtNum(spreadBps, 1)}bps`, "yellow")
      : this.style.wrap(`${fmtNum(spreadBps, 1)}bps`, "green");

    const midSpreadRow = `${midLabel} ${midVal}    ${spreadLabel} ${spreadVal}`;
    lines.push(this.boxRow(midSpreadRow, width));

    // Mark/Index Row
    const markLabel = `${this.style.token("dim")}Mark:${this.style.token("reset")}`;
    const indexLabel = `${this.style.token("dim")}Index:${this.style.token("reset")}`;
    const ageLabel = `${this.style.token("dim")}Age:${this.style.token("reset")}`;

    const markVal = t.snapshot.markPx ?? "-";
    const indexVal = t.snapshot.indexPx ?? "-";
    const ageStyle = dataAge.includes("s") || dataAge.includes("m") ? "yellow" : "green";
    const ageVal = this.style.wrap(dataAge, ageStyle);

    const markIndexRow = `${markLabel} ${markVal}    ${indexLabel} ${indexVal}    ${ageLabel} ${ageVal}`;
    lines.push(this.boxRow(markIndexRow, width));

    // Funding Rate Row (displayed as % with color coding)
    const fundingLabel = `${this.style.token("dim")}Funding:${this.style.token("reset")}`;
    if (t.funding?.rate != null) {
      const rateNum = Number.parseFloat(t.funding.rate);
      // Convert to percentage (e.g., 0.0001 -> 0.01%)
      const ratePct = rateNum * 100;
      const rateStr = `${ratePct >= 0 ? "+" : ""}${ratePct.toFixed(4)}%`;
      const rateColor: Parameters<Style["wrap"]>[1][] =
        rateNum > 0 ? ["bold", "green"]
        : rateNum < 0 ? ["bold", "red"]
        : ["dim"];
      const rateVal = this.style.wrap(rateStr, ...rateColor);
      const fundingAge = t.funding.tsMs !== undefined ? this.layout.formatAgeMs(t.nowMs, t.funding.tsMs) : "-";
      const fundingAgeLabel = `${this.style.token("dim")}age:${this.style.token("reset")}`;
      const fundingRow = `${fundingLabel} ${rateVal}    ${fundingAgeLabel} ${fundingAge}`;
      lines.push(this.boxRow(fundingRow, width));
    } else {
      lines.push(this.boxRow(`${fundingLabel} ${this.style.wrap("-", "dim")}`, width));
    }

    lines.push(this.layout.boxLine(width, "middle"));
    return lines;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Strategy & Params Section
  // ─────────────────────────────────────────────────────────────────────────────

  private renderStrategySection(nowMs: number, width: number): string[] {
    const lines: string[] = [];
    const t = this.tick;

    const sectionTitle = this.style.wrap("STRATEGY", "bold", "magenta");
    lines.push(this.layout.sectionHeader(sectionTitle, width));

    if (!t) {
      lines.push(this.boxRow(`${this.style.token("dim")}No strategy data${this.style.token("reset")}`, width));
      lines.push(this.layout.boxLine(width, "middle"));
      return lines;
    }

    // Mode badge
    const mode = t.stateAfter.mode;
    const modeBadge = this.renderModeBadge(mode);
    const pauseMs = t.stateAfter.pauseUntilMs !== undefined ? Math.max(0, t.stateAfter.pauseUntilMs - t.nowMs) : 0;
    const pauseInfo =
      pauseMs > 0 ?
        `${this.style.token("dim")}pause:${this.style.token("reset")} ${this.style.wrap(`${String(pauseMs)}ms`, "yellow")}`
      : "";

    const modeRow = `${this.style.token("dim")}Mode:${this.style.token("reset")} ${modeBadge}  ${pauseInfo}`;
    lines.push(this.boxRow(modeRow, width));

    // Reasons & Intents
    const reasons = t.output.reasonCodes;
    const intents = t.output.intents.map(i => i.type);
    const reasonsStr =
      reasons.length > 0 ?
        reasons.map(r => this.style.wrap(r, "cyan")).join(", ")
      : this.style.token("dim") + "none" + this.style.token("reset");
    const intentsStr =
      intents.length > 0 ?
        intents.map(i => this.style.wrap(i, "magenta")).join(", ")
      : this.style.token("dim") + "none" + this.style.token("reset");

    lines.push(this.boxRow(`${this.style.token("dim")}Reasons:${this.style.token("reset")} ${reasonsStr}`, width));
    lines.push(this.boxRow(`${this.style.token("dim")}Intents:${this.style.token("reset")} ${intentsStr}`, width));

    // Params subsection
    lines.push(this.boxRow("", width));
    const paramsTitle = this.style.wrap("Params", "bold", "underline");
    lines.push(this.boxRow(paramsTitle, width));

    // Show recent params change notification (highlighted for 30s)
    if (this.lastParamsChange && nowMs - this.lastParamsChange.changedAt < this.paramsChangeHighlightMs) {
      const changeAge = this.layout.formatAgeMs(nowMs, this.lastParamsChange.changedAt);
      const sourceLabel =
        this.lastParamsChange.source === "db_refresh" ? "DB"
        : this.lastParamsChange.source === "proposal_apply" ? "PROPOSAL"
        : "REJECT";

      const sourceBadge =
        this.lastParamsChange.source === "proposal_reject" ? this.style.badge(sourceLabel, "bgRed", "white", "bold")
        : this.lastParamsChange.source === "proposal_apply" ? this.style.badge(sourceLabel, "bgGreen", "white", "bold")
        : this.style.badge(sourceLabel, "bgCyan", "white");

      let changeInfo = `${this.style.token("dim")}Last:${this.style.token("reset")} ${sourceBadge} ${changeAge} ago`;
      if (this.lastParamsChange.changedKeys && this.lastParamsChange.changedKeys.length > 0) {
        changeInfo += ` ${this.style.token("dim")}keys:${this.style.token("reset")}${this.style.wrap(this.lastParamsChange.changedKeys.join(","), "yellow")}`;
      }
      if (this.lastParamsChange.rejectReason !== undefined && this.lastParamsChange.rejectReason !== "") {
        const shortReason =
          this.lastParamsChange.rejectReason.length > 30 ?
            this.lastParamsChange.rejectReason.slice(0, 27) + "..."
          : this.lastParamsChange.rejectReason;
        changeInfo += ` ${this.style.wrap(shortReason, "red")}`;
      }
      lines.push(this.boxRow(changeInfo, width));
    }

    const dbBaseHalf = t.dbParams.baseHalfSpreadBps;
    const effBaseHalf = t.effectiveParams.baseHalfSpreadBps;
    const tightenBps = t.overlayState.tightenBps;
    const overlayActive = t.overlayState.active;

    // BaseHalf comparison (highlight if tightened)
    const dbLabel = `${this.style.token("dim")}DB:${this.style.token("reset")}`;
    const effLabel = `${this.style.token("dim")}Eff:${this.style.token("reset")}`;
    const effVal = tightenBps > 0 ? this.style.wrap(effBaseHalf, "bold", "cyan") : effBaseHalf;
    const tightenLabel = `${this.style.token("dim")}Tighten:${this.style.token("reset")}`;
    const tightenVal =
      tightenBps > 0 ?
        this.style.wrap(`-${tightenBps.toFixed(1)}bps`, "cyan")
      : this.style.token("dim") + "0" + this.style.token("reset");

    const halfSpreadRow = `baseHalf  ${dbLabel} ${dbBaseHalf}  ${effLabel} ${effVal}  ${tightenLabel} ${tightenVal}`;
    lines.push(this.boxRow(halfSpreadRow, width));

    // Other params in compact format
    const paramsCompact = [
      `${this.style.token("dim")}vol:${this.style.token("reset")}${t.dbParams.volSpreadGain}`,
      `${this.style.token("dim")}tox:${this.style.token("reset")}${t.dbParams.toxSpreadGain}`,
      `${this.style.token("dim")}skew:${this.style.token("reset")}${t.dbParams.inventorySkewGain}`,
      `${this.style.token("dim")}qUsd:${this.style.token("reset")}${this.style.wrap(t.dbParams.quoteSizeUsd, "bold")}`,
      `${this.style.token("dim")}overlay:${this.style.token("reset")}${overlayActive ? this.style.wrap("ON", "green") : this.style.wrap("OFF", "dim")}`,
    ].join("  ");
    lines.push(this.boxRow(paramsCompact, width));

    // Target quote
    const q = t.targetQuote;
    if (q) {
      const tgtBid = this.style.wrap(q.bidPx, "green");
      const tgtAsk = this.style.wrap(q.askPx, "red");
      const tgtSz = this.style.wrap(q.size, "bold");
      lines.push(
        this.boxRow(
          `${this.style.token("dim")}Target:${this.style.token("reset")} ${tgtBid} / ${tgtAsk}  ${this.style.token("dim")}size:${this.style.token("reset")} ${tgtSz}`,
          width,
        ),
      );
    }

    // Features
    lines.push(this.boxRow("", width));
    const featTitle = this.style.wrap("Features", "bold", "underline");
    lines.push(this.boxRow(featTitle, width));

    const featRow = [
      `${this.style.token("dim")}vol10s:${this.style.token("reset")}${t.features.realizedVol10s}`,
      `${this.style.token("dim")}tox1s:${this.style.token("reset")}${t.features.tradeImbalance1s}`,
      `${this.style.token("dim")}mrkIdx:${this.style.token("reset")}${t.features.markIndexDivBps}`,
      `${this.style.token("dim")}liq10s:${this.style.token("reset")}${String(t.features.liqCount10s)}`,
    ].join("  ");
    lines.push(this.boxRow(featRow, width));

    // Position / Inventory (use realtime position if available for immediate updates on fills)
    lines.push(this.boxRow("", width));
    const posTitle = this.style.wrap("Position / Inventory", "bold", "underline");
    lines.push(this.boxRow(posTitle, width));

    // Use realtime position if available (updated on fills), fallback to tick position
    const pos = this.realtimePosition ?? t.position;
    const posSize = Number.parseFloat(pos.size);
    const maxInventory = Number.parseFloat(t.effectiveParams.maxInventory);
    const inventorySkewGain = Number.parseFloat(t.effectiveParams.inventorySkewGain);

    // Inventory direction
    const invDir =
      posSize > 0 ? "LONG"
      : posSize < 0 ? "SHORT"
      : "FLAT";
    const invDirStyle: Parameters<Style["wrap"]>[1][] =
      posSize > 0 ? ["bold", "green"]
      : posSize < 0 ? ["bold", "red"]
      : ["dim"];
    const invDirStr = this.style.wrap(invDir, ...invDirStyle);

    // Inventory utilization (abs(size) / maxInventory)
    const absSize = Math.abs(posSize);
    const utilization = maxInventory > 0 ? (absSize / maxInventory) * 100 : 0;
    const utilPct = fmtNum(utilization, 1);

    // Utilization color: green < 80%, yellow 80-100%, red >= 100%
    const utilStyle: Parameters<Style["wrap"]>[1][] =
      utilization >= 100 ? ["bold", "red"]
      : utilization >= 80 ? ["bold", "yellow"]
      : ["green"];
    const utilStr = this.style.wrap(`${utilPct}%`, ...utilStyle);

    // Inventory skew in bps
    const skewBps = inventorySkewGain * posSize;
    const skewSign = skewBps >= 0 ? "+" : "";
    const skewStr =
      skewBps !== 0 ?
        this.style.wrap(`${skewSign}${fmtNum(skewBps, 1)}bps`, posSize > 0 ? "green" : "red")
      : this.style.wrap("0bps", "dim");

    // Size with color
    const posSizeStyle: Parameters<Style["wrap"]>[1][] =
      posSize > 0 ? ["bold", "green"]
      : posSize < 0 ? ["bold", "red"]
      : ["dim"];
    const posSizeStr = this.style.wrap(pos.size, ...posSizeStyle);

    // Entry and PnL
    const posEntry = pos.entryPrice ?? "-";
    const posPnl = pos.unrealizedPnl;
    const pnlVal = posPnl !== undefined && posPnl !== "" ? Number.parseFloat(posPnl) : null;
    const pnlStyle: Parameters<Style["wrap"]>[1][] =
      pnlVal !== null && pnlVal > 0 ? ["bold", "green"]
      : pnlVal !== null && pnlVal < 0 ? ["bold", "red"]
      : ["dim"];
    const pnlStr = posPnl !== undefined && posPnl !== "" ? this.style.wrap(posPnl, ...pnlStyle) : "-";

    // Position row 1: Size, Direction, Utilization, Max
    const posRow1 = `${this.style.token("dim")}Size:${this.style.token("reset")} ${posSizeStr}  ${this.style.token("dim")}Dir:${this.style.token("reset")} ${invDirStr}  ${this.style.token("dim")}Util:${this.style.token("reset")} ${utilStr}  ${this.style.token("dim")}Max:${this.style.token("reset")} ${t.effectiveParams.maxInventory}`;
    lines.push(this.boxRow(posRow1, width));

    // Position row 2: Skew, Entry, uPnL
    const posRow2 = `${this.style.token("dim")}Skew:${this.style.token("reset")} ${skewStr}  ${this.style.token("dim")}Entry:${this.style.token("reset")} ${posEntry}  ${this.style.token("dim")}uPnL:${this.style.token("reset")} ${pnlStr}`;
    lines.push(this.boxRow(posRow2, width));

    lines.push(this.layout.boxLine(width, "middle"));
    return lines;
  }

  private renderModeBadge(mode: string): string {
    switch (mode) {
      case "NORMAL":
        return this.style.badge("NORMAL", "bgGreen", "white", "bold");
      case "DEFENSIVE":
        return this.style.badge("DEFENSIVE", "bgYellow", "white", "bold");
      case "PAUSE":
        return this.style.badge("PAUSE", "bgRed", "white", "bold");
      default:
        return this.style.badge(mode, "bgGray", "white");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Orders Section
  // ─────────────────────────────────────────────────────────────────────────────

  private renderOrdersSection(nowMs: number, width: number): string[] {
    const lines: string[] = [];
    const t = this.tick;
    const inner = this.innerWidth(width);

    const sectionTitle = this.style.wrap("ORDERS", "bold", "yellow");
    lines.push(this.layout.sectionHeader(sectionTitle, width));

    if (!t) {
      lines.push(this.boxRow(`${this.style.token("dim")}No order data${this.style.token("reset")}`, width));
      lines.push(this.layout.boxLine(width, "middle"));
      return lines;
    }

    const orders = [...t.orders];

    if (orders.length === 0) {
      lines.push(this.boxRow(`${this.style.token("dim")}No active orders${this.style.token("reset")}`, width));
    } else {
      const buys = orders
        .filter(o => o.side === "buy")
        .sort((a, b) => Number.parseFloat(b.price) - Number.parseFloat(a.price));
      const sells = orders
        .filter(o => o.side === "sell")
        .sort((a, b) => Number.parseFloat(a.price) - Number.parseFloat(b.price));

      // Summary line
      const totalBadge = this.style.wrap(String(orders.length), "bold", "white");
      const buyCount = this.style.wrap(String(buys.length), "green");
      const sellCount = this.style.wrap(String(sells.length), "red");
      lines.push(
        this.boxRow(
          `${this.style.token("dim")}Active:${this.style.token("reset")} ${totalBadge}  ${this.style.token("dim")}Buy:${this.style.token("reset")} ${buyCount}  ${this.style.token("dim")}Sell:${this.style.token("reset")} ${sellCount}`,
          width,
        ),
      );

      // Calculate dynamic column widths based on available space
      // Fixed columns: SIDE(5) + separators(8) = 13 chars minimum
      // Remaining space distributed among PRICE, SIZE, FILLED, AGE, ID
      const colSide = 5;
      const colAge = 7;
      const separators = 8; // 4 x "  " between columns
      const fixedWidth = colSide + colAge + separators;
      const remaining = Math.max(30, inner - fixedWidth);

      // Distribute remaining: PRICE(30%), SIZE(20%), FILLED(20%), ID(30%)
      const colPx = Math.max(8, Math.floor(remaining * 0.3));
      const colSz = Math.max(6, Math.floor(remaining * 0.2));
      const colFill = Math.max(6, Math.floor(remaining * 0.2));
      const colId = Math.max(8, remaining - colPx - colSz - colFill);

      // Table header
      const hdrSide = this.layout.padRight("SIDE", colSide);
      const hdrPx = this.layout.padLeft("PRICE", colPx);
      const hdrSz = this.layout.padLeft("SIZE", colSz);
      const hdrFill = this.layout.padLeft("FILL", colFill);
      const hdrAge = this.layout.padLeft("AGE", colAge);
      const hdrId = this.layout.padRight("ID", colId);
      const tableHdr = `${this.style.token("dim")}${hdrSide}  ${hdrPx}  ${hdrSz}  ${hdrFill}  ${hdrAge}  ${hdrId}${this.style.token("reset")}`;
      lines.push(this.boxRow(tableHdr, width));

      // Order rows (max 3 each side)
      const renderOrderRow = (o: TrackedOrder) => {
        const sideColor = o.side === "buy" ? "green" : "red";
        const sideStr = this.style.wrap(this.layout.padRight(o.side.toUpperCase(), colSide), "bold", sideColor);

        // Truncate price/size if too long
        const pxTrunc = o.price.length > colPx ? o.price.slice(0, colPx - 1) + "…" : o.price;
        const szTrunc = o.size.length > colSz ? o.size.slice(0, colSz - 1) + "…" : o.size;
        const fillTrunc = o.filledSize.length > colFill ? o.filledSize.slice(0, colFill - 1) + "…" : o.filledSize;

        const pxStr = this.layout.padLeft(pxTrunc, colPx);
        const szStr = this.layout.padLeft(szTrunc, colSz);
        const fillStr = this.layout.padLeft(fillTrunc, colFill);
        const ageStr = this.layout.padLeft(this.layout.formatAgeMs(t.nowMs, o.createdAtMs), colAge);

        // Truncate ID to fit
        const idMaxLen = colId - 1; // Reserve 1 for "…"
        const idShort =
          o.clientOrderId.length > idMaxLen ? "…" + o.clientOrderId.slice(-idMaxLen + 1) : o.clientOrderId;
        const idStr = this.style.token("dim") + this.layout.padRight(idShort, colId) + this.style.token("reset");

        return this.boxRow(`${sideStr}  ${pxStr}  ${szStr}  ${fillStr}  ${ageStr}  ${idStr}`, width);
      };

      for (const o of buys.slice(0, 3)) lines.push(renderOrderRow(o));
      for (const o of sells.slice(0, 3)) lines.push(renderOrderRow(o));

      if (buys.length > 3 || sells.length > 3) {
        const moreCount = Math.max(0, buys.length - 3) + Math.max(0, sells.length - 3);
        lines.push(
          this.boxRow(`${this.style.token("dim")}... +${String(moreCount)} more${this.style.token("reset")}`, width),
        );
      }
    }

    // Planned actions (truncate if too long)
    if (t.plannedActions.length > 0) {
      lines.push(this.boxRow("", width));
      const planLabel = this.style.wrap("Plan:", "bold", "underline");

      // Limit number of actions shown to avoid overflow
      const maxActions = Math.min(t.plannedActions.length, 4);
      const actionsStr = t.plannedActions
        .slice(0, maxActions)
        .map(a => {
          if (a.type === "cancel_all") return this.style.wrap("CANCEL_ALL", "bold", "red");
          if (a.type === "cancel") {
            const shortId = a.clientOrderId.slice(-6);
            return this.style.wrap(`canc(${shortId})`, "yellow");
          }
          const color = a.side === "buy" ? "green" : "red";
          // Truncate price for compact display
          const shortPx = a.price.length > 8 ? a.price.slice(0, 7) + "…" : a.price;
          return this.style.wrap(`${a.side[0]}@${shortPx}`, color);
        })
        .join(` ${this.style.token("dim")}→${this.style.token("reset")} `);

      const moreActions =
        t.plannedActions.length > maxActions ? ` +${String(t.plannedActions.length - maxActions)}` : "";
      lines.push(this.boxRow(`${planLabel} ${actionsStr}${moreActions}`, width));
    }

    lines.push(this.layout.boxLine(width, "middle"));
    return lines;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Logs Section
  // ─────────────────────────────────────────────────────────────────────────────

  private renderLogsSection(width: number): string[] {
    const lines: string[] = [];

    const sectionTitle = this.style.wrap("LOGS", "bold", "cyan");
    lines.push(this.layout.sectionHeader(sectionTitle, width));

    const recentLogs = this.logs.latest(300).slice().reverse().slice(0, 10);

    if (recentLogs.length === 0) {
      lines.push(this.boxRow(`${this.style.token("dim")}No logs yet${this.style.token("reset")}`, width));
    } else {
      for (const r of recentLogs) {
        const time = new Date(r.tsMs).toISOString().slice(11, 19);
        const timeStr = this.style.token("dim") + time + this.style.token("reset");

        let levelBadge: string;
        let msgStyle: Parameters<Style["wrap"]>[1][] = [];

        switch (r.level) {
          case LogLevel.ERROR:
            levelBadge = this.style.badge("ERR", "bgRed", "white", "bold");
            msgStyle = ["red"];
            break;
          case LogLevel.WARN:
            levelBadge = this.style.badge("WRN", "bgYellow", "white", "bold");
            msgStyle = ["yellow"];
            break;
          case LogLevel.INFO:
            levelBadge = this.style.wrap("INF", "cyan");
            break;
          case LogLevel.DEBUG:
            levelBadge = this.style.wrap("DBG", "dim");
            msgStyle = ["dim"];
            break;
          case LogLevel.LOG:
            levelBadge = this.style.wrap("LOG", "dim");
            break;
        }

        const msgContent = msgStyle.length > 0 ? this.style.wrap(r.message, ...msgStyle) : r.message;

        // Truncate line if too long
        const fullLine = `${timeStr} ${levelBadge} ${msgContent}`;
        const truncatedLine =
          this.layout.visibleLength(fullLine) > width - 4 ? this.layout.truncate(fullLine, width - 4) : fullLine;

        lines.push(this.boxRow(truncatedLine, width));
      }
    }

    // Bottom border
    lines.push(this.layout.boxLine(width, "bottom"));
    return lines;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helper: Wrap content in box row (with truncation to prevent overflow)
  // ─────────────────────────────────────────────────────────────────────────────

  private boxRow(content: string, width: number): string {
    const innerWidth = Math.max(0, width - 4); // 2 for borders, 2 for padding
    const visLen = this.layout.visibleLength(content);

    // Truncate if content is too long
    const finalContent = visLen > innerWidth ? this.layout.truncate(content, innerWidth) : content;

    // Pad to fill the row
    const paddedContent = this.layout.padRight(finalContent, innerWidth);
    return `${BOX.vertical} ${paddedContent} ${BOX.vertical}`;
  }

  /**
   * Get available inner width for content (excluding box borders and padding)
   */
  private innerWidth(width: number): number {
    return Math.max(0, width - 4);
  }
}
