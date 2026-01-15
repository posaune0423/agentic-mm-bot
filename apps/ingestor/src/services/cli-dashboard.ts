/**
 * CLI Dashboard (TTY UI)
 *
 * Goal: Make it obvious what ingestor is doing "right now" from the terminal:
 * - Connection status
 * - Latest data (BBO / trade / prices / funding)
 * - Throttle decisions (why BBO was written or skipped)
 * - DB buffers / dead letter size
 */
import type { BboEvent, FundingRateEvent, PriceEvent, TradeEvent } from "@agentic-mm-bot/adapters";
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
import type { IngestorMetrics } from "../types";

type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";
type IngestorPhase = "IDLE" | "CONNECTING" | "SUBSCRIBED" | "RECEIVING" | "FLUSHING";

interface BboDecision {
  shouldWrite: boolean;
  reason: "first_write" | "time_throttle" | "price_change" | "throttled";
  throttleMs: number;
  minChangeBps: number;
  timeSinceLastWriteMs: number;
  lastMid: number | null;
  currentMid: number;
  changeBps: number | null;
}

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return n.toFixed(digits);
}

export class IngestorCliDashboard {
  private readonly enabled: boolean;
  private readonly exchange: string;
  private readonly symbol: string;
  private readonly refreshMs: number;
  private readonly staleMs: number;

  private readonly style: Style;
  private readonly layout: LayoutPolicy;
  private readonly screen: TTYScreen;
  private readonly renderer: TTYRenderer;
  private readonly logs: LogBuffer;
  private readonly flow: FlowStatusTracker<IngestorPhase>;

  private status: ConnectionStatus = "connecting";
  private statusReason?: string;
  private lastReceiveAtMs = Date.now();
  private hasStaleWarned = false;

  private metrics: IngestorMetrics;
  private lastMetricsSampleAtMs = Date.now();
  private lastMetricsSample: IngestorMetrics;

  private lastBbo?: BboEvent;
  private lastTrade?: TradeEvent;
  private lastPrice?: PriceEvent;
  private lastFunding?: FundingRateEvent;

  private lastBboDecision?: BboDecision;

  private bufferSizes: { bbo: number; trade: number; price: number } = {
    bbo: 0,
    trade: 0,
    price: 0,
  };
  private deadLetterSize = 0;

  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(args: {
    enabled: boolean;
    exchange: string;
    symbol: string;
    initialMetrics: IngestorMetrics;
    refreshMs?: number;
    staleMs?: number;
    maxLogs?: number;
  }) {
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
    this.staleMs = args.staleMs ?? 3_000;

    this.style = new Style();
    this.layout = new LayoutPolicy();
    this.renderer = new TTYRenderer(chunk => process.stdout.write(chunk));
    this.screen = new TTYScreen({
      enabled: this.enabled,
      write: chunk => process.stdout.write(chunk),
    });
    this.logs = new LogBuffer(args.maxLogs ?? 200);
    this.flow = new FlowStatusTracker<IngestorPhase>("CONNECTING", Date.now());

    this.metrics = { ...args.initialMetrics };
    this.lastMetricsSample = { ...args.initialMetrics };
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  start(): void {
    if (!this.enabled || this.interval) return;

    this.screen.start();
    this.renderer.reset();

    // Route logs into dashboard (avoid stdout/stderr collisions).
    logger.setSink({
      write: r => {
        this.logs.push(r);
      },
    });

    // Render loop: snapshot-only, never blocks hot paths.
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
    this.status = status;
    this.statusReason = reason;
    this.pushEvent(
      status === "disconnected" ? LogLevel.WARN : LogLevel.INFO,
      `market data: ${status}`,
      reason !== undefined && reason !== "" ? { reason } : undefined,
    );
  }

  setBuffers(args: { bufferSizes: { bbo: number; trade: number; price: number }; deadLetterSize: number }): void {
    this.bufferSizes = args.bufferSizes;
    this.deadLetterSize = args.deadLetterSize;
  }

  setMetrics(metrics: IngestorMetrics): void {
    this.metrics = metrics;
  }

  enterPhase(phase: IngestorPhase, nowMs = Date.now()): void {
    this.flow.enterPhase(phase, nowMs);
  }

  onBbo(event: BboEvent, decision?: BboDecision): void {
    this.lastBbo = event;
    if (decision) this.lastBboDecision = decision;
    this.lastReceiveAtMs = Date.now();
  }

  onTrade(event: TradeEvent): void {
    this.lastTrade = event;
    this.lastReceiveAtMs = Date.now();
  }

  onPrice(event: PriceEvent): void {
    this.lastPrice = event;
    this.lastReceiveAtMs = Date.now();
  }

  onFunding(event: FundingRateEvent): void {
    this.lastFunding = event;
    this.lastReceiveAtMs = Date.now();
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
    const W = Math.min(this.layout.getTerminalWidth(), 140);

    // Derive IDLE based on receive quietness
    const quietMs = nowMs - this.lastReceiveAtMs;
    const isStale = quietMs >= this.staleMs;
    if (isStale && !this.hasStaleWarned) {
      this.hasStaleWarned = true;
      this.pushEvent(LogLevel.WARN, "market data stale (no events)", {
        quietMs,
        staleMs: this.staleMs,
        status: this.status,
        reason: this.statusReason ?? null,
      });
    } else if (!isStale && this.hasStaleWarned && quietMs <= Math.floor(this.staleMs / 2)) {
      this.hasStaleWarned = false;
    }
    if (quietMs >= Math.max(2000, this.refreshMs * 4)) {
      this.flow.enterPhase("IDLE", nowMs);
    } else if (this.status === "connected" || this.status === "reconnecting") {
      this.flow.enterPhase("RECEIVING", nowMs);
    }

    // Calculate rates
    const dtMs = Math.max(1, nowMs - this.lastMetricsSampleAtMs);
    const perSec = (d: number) => (d * 1000) / dtMs;
    const delta = {
      bboReceived: this.metrics.bboReceived - this.lastMetricsSample.bboReceived,
      bboWritten: this.metrics.bboWritten - this.lastMetricsSample.bboWritten,
      tradeReceived: this.metrics.tradeReceived - this.lastMetricsSample.tradeReceived,
      priceReceived: this.metrics.priceReceived - this.lastMetricsSample.priceReceived,
      fundingReceived: this.metrics.fundingReceived - this.lastMetricsSample.fundingReceived,
    };
    if (dtMs >= 1000) {
      this.lastMetricsSampleAtMs = nowMs;
      this.lastMetricsSample = { ...this.metrics };
    }

    const lines: string[] = [];

    // HEADER
    lines.push(...this.renderHeader(nowMs, W, quietMs));

    // MARKET DATA
    lines.push(...this.renderMarketData(nowMs, W));

    // THROTTLE DECISION
    lines.push(...this.renderThrottleDecision(W));

    // METRICS
    lines.push(...this.renderMetrics(W, delta, perSec));

    // BUFFERS
    lines.push(...this.renderBuffers(W));

    // LOGS
    lines.push(...this.renderLogs(W));

    this.renderer.render(lines);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Header Section
  // ─────────────────────────────────────────────────────────────────────────────

  private renderHeader(nowMs: number, width: number, quietMs: number): string[] {
    const lines: string[] = [];

    const title = this.style.wrap("INGESTOR DASHBOARD", "bold", "white");
    const symbol = this.style.wrap(`${this.exchange}/${this.symbol}`, "bold", "cyan");

    // Connection badge
    const connBadge = this.renderConnectionBadge();

    // Uptime
    const uptime = this.layout.formatDurationMs(Math.floor(process.uptime() * 1000));
    const uptimeLabel = `${this.style.token("dim")}uptime${this.style.token("reset")} ${uptime}`;

    // Phase badge
    const flowSnap = this.flow.snapshot();
    const phaseBadge = this.renderPhaseBadge(flowSnap.phase);

    // Quiet time (highlight if stale)
    const quietStyle = quietMs >= this.staleMs ? "yellow" : "dim";
    const quietLabel = `${this.style.token("dim")}quiet:${this.style.token("reset")} ${this.style.wrap(`${String(quietMs)}ms`, quietStyle)}`;

    lines.push(this.layout.sectionHeader(title, width));
    lines.push(this.boxRow(`${symbol}  ${connBadge}  ${uptimeLabel}`, width));
    lines.push(
      this.boxRow(`${this.style.token("dim")}Phase:${this.style.token("reset")} ${phaseBadge}  ${quietLabel}`, width),
    );
    lines.push(this.layout.boxLine(width, "middle"));

    return lines;
  }

  private renderConnectionBadge(): string {
    switch (this.status) {
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

  private renderPhaseBadge(phase: IngestorPhase): string {
    switch (phase) {
      case "RECEIVING":
        return this.style.wrap(phase, "bold", "green");
      case "FLUSHING":
        return this.style.wrap(phase, "bold", "magenta");
      case "SUBSCRIBED":
        return this.style.wrap(phase, "bold", "cyan");
      case "CONNECTING":
        return this.style.wrap(phase, "bold", "yellow");
      case "IDLE":
        return this.style.wrap(phase, "dim");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Market Data Section
  // ─────────────────────────────────────────────────────────────────────────────

  private renderMarketData(nowMs: number, width: number): string[] {
    const lines: string[] = [];

    const sectionTitle = this.style.wrap("MARKET DATA", "bold", "blue");
    lines.push(this.layout.sectionHeader(sectionTitle, width));

    // BBO
    if (this.lastBbo) {
      const bid = Number.parseFloat(this.lastBbo.bestBidPx);
      const ask = Number.parseFloat(this.lastBbo.bestAskPx);
      const mid = (bid + ask) / 2;
      const spreadBps = mid > 0 ? ((ask - bid) / mid) * 10000 : null;
      const ageMs = nowMs - this.lastBbo.ts.getTime();
      const isStale = ageMs >= this.staleMs;

      const bidLabel = this.style.wrap("BID", "bold", "green");
      const askLabel = this.style.wrap("ASK", "bold", "red");
      const bidPx = this.style.wrap(this.lastBbo.bestBidPx.padStart(10), "green");
      const askPx = this.style.wrap(this.lastBbo.bestAskPx.padStart(10), "red");
      const bidSz = this.style.wrap(this.lastBbo.bestBidSz.padStart(8), "dim");
      const askSz = this.style.wrap(this.lastBbo.bestAskSz.padStart(8), "dim");

      lines.push(this.boxRow(`${bidLabel} ${bidPx} × ${bidSz}    ${askLabel} ${askPx} × ${askSz}`, width));

      const midLabel = `${this.style.token("dim")}Mid:${this.style.token("reset")}`;
      const midVal = this.style.wrap(fmtNum(mid, 2), "bold", "white");
      const spreadLabel = `${this.style.token("dim")}Spread:${this.style.token("reset")}`;
      const spreadVal =
        spreadBps !== null && spreadBps > 10 ?
          this.style.wrap(`${fmtNum(spreadBps, 1)}bps`, "yellow")
        : this.style.wrap(`${fmtNum(spreadBps, 1)}bps`, "green");
      const ageLabel = `${this.style.token("dim")}Age:${this.style.token("reset")}`;
      const ageVal = this.style.wrap(
        this.layout.formatAgeMs(nowMs, this.lastBbo.ts.getTime()),
        isStale ? "yellow" : "green",
      );

      lines.push(this.boxRow(`${midLabel} ${midVal}    ${spreadLabel} ${spreadVal}    ${ageLabel} ${ageVal}`, width));
    } else {
      lines.push(this.boxRow(`${this.style.token("dim")}BBO: No data${this.style.token("reset")}`, width));
    }

    // Trade
    lines.push(this.boxRow("", width));
    if (this.lastTrade) {
      const side = this.lastTrade.side;
      const sideColor =
        side === "buy" ? "green"
        : side === "sell" ? "red"
        : "dim";
      const sideStr = side ? this.style.wrap(side.toUpperCase(), "bold", sideColor) : this.style.wrap("-", "dim");
      const tradeAge = this.layout.formatAgeMs(nowMs, this.lastTrade.ts.getTime());
      const tradeType = this.lastTrade.tradeType ?? "-";
      lines.push(
        this.boxRow(
          `${this.style.token("dim")}Trade:${this.style.token("reset")} ${sideStr} ${this.style.token("dim")}px:${this.style.token("reset")}${this.lastTrade.px} ${this.style.token("dim")}sz:${this.style.token("reset")}${this.lastTrade.sz} ${this.style.token("dim")}type:${this.style.token("reset")}${tradeType} ${this.style.token("dim")}age:${this.style.token("reset")}${tradeAge}`,
          width,
        ),
      );
    } else {
      lines.push(this.boxRow(`${this.style.token("dim")}Trade: No data${this.style.token("reset")}`, width));
    }

    // Price (Mark/Index)
    if (this.lastPrice) {
      const priceAge = this.layout.formatAgeMs(nowMs, this.lastPrice.ts.getTime());
      lines.push(
        this.boxRow(
          `${this.style.token("dim")}Price:${this.style.token("reset")} ${this.style.token("dim")}mark:${this.style.token("reset")}${this.lastPrice.markPx ?? "-"} ${this.style.token("dim")}index:${this.style.token("reset")}${this.lastPrice.indexPx ?? "-"} ${this.style.token("dim")}age:${this.style.token("reset")}${priceAge}`,
          width,
        ),
      );
    } else {
      lines.push(this.boxRow(`${this.style.token("dim")}Price: No data${this.style.token("reset")}`, width));
    }

    // Funding
    if (this.lastFunding) {
      const fundAge = this.layout.formatAgeMs(nowMs, this.lastFunding.ts.getTime());
      const rate = Number.parseFloat(this.lastFunding.fundingRate);
      const rateColor =
        rate > 0 ? "green"
        : rate < 0 ? "red"
        : "dim";
      lines.push(
        this.boxRow(
          `${this.style.token("dim")}Funding:${this.style.token("reset")} ${this.style.wrap(this.lastFunding.fundingRate, rateColor)} ${this.style.token("dim")}age:${this.style.token("reset")}${fundAge}`,
          width,
        ),
      );
    } else {
      lines.push(this.boxRow(`${this.style.token("dim")}Funding: No data${this.style.token("reset")}`, width));
    }

    lines.push(this.layout.boxLine(width, "middle"));
    return lines;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Throttle Decision Section
  // ─────────────────────────────────────────────────────────────────────────────

  private renderThrottleDecision(width: number): string[] {
    const lines: string[] = [];

    const sectionTitle = this.style.wrap("BBO THROTTLE", "bold", "magenta");
    lines.push(this.layout.sectionHeader(sectionTitle, width));

    if (this.lastBboDecision) {
      const d = this.lastBboDecision;

      // Decision badge
      const decBadge =
        d.shouldWrite ?
          this.style.badge("WRITE", "bgGreen", "white", "bold")
        : this.style.badge("SKIP", "bgGray", "white");

      // Reason
      let reasonStr: string;
      switch (d.reason) {
        case "first_write":
          reasonStr = this.style.wrap("first write", "cyan");
          break;
        case "time_throttle":
          reasonStr = `${this.style.wrap("time", "yellow")} ≥${String(d.throttleMs)}ms`;
          break;
        case "price_change":
          reasonStr = `${this.style.wrap("Δmid", "green")} ≥${String(d.minChangeBps)}bps`;
          break;
        case "throttled":
          reasonStr = this.style.wrap("throttled", "dim");
          break;
      }

      lines.push(
        this.boxRow(
          `${this.style.token("dim")}Decision:${this.style.token("reset")} ${decBadge}  ${this.style.token("dim")}Reason:${this.style.token("reset")} ${reasonStr}`,
          width,
        ),
      );

      // Details
      const sinceLastWrite = `${this.style.token("dim")}since_write:${this.style.token("reset")} ${String(d.timeSinceLastWriteMs)}ms`;
      const changeBps =
        d.changeBps !== null ?
          `${this.style.token("dim")}Δbps:${this.style.token("reset")} ${this.style.wrap(fmtNum(d.changeBps, 2), d.changeBps >= d.minChangeBps ? "green" : "dim")}`
        : `${this.style.token("dim")}Δbps:${this.style.token("reset")} -`;

      lines.push(this.boxRow(`${sinceLastWrite}  ${changeBps}`, width));
    } else {
      lines.push(this.boxRow(`${this.style.token("dim")}No throttle decision yet${this.style.token("reset")}`, width));
    }

    lines.push(this.layout.boxLine(width, "middle"));
    return lines;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Metrics Section
  // ─────────────────────────────────────────────────────────────────────────────

  private renderMetrics(
    width: number,
    delta: {
      bboReceived: number;
      bboWritten: number;
      tradeReceived: number;
      priceReceived: number;
      fundingReceived: number;
    },
    perSec: (d: number) => number,
  ): string[] {
    const lines: string[] = [];

    const sectionTitle = this.style.wrap("METRICS", "bold", "yellow");
    lines.push(this.layout.sectionHeader(sectionTitle, width));

    // BBO metrics
    const bboRecv = this.style.wrap(String(this.metrics.bboReceived), "bold");
    const bboRecvRate = `${this.style.token("dim")}(${fmtNum(perSec(delta.bboReceived), 1)}/s)${this.style.token("reset")}`;
    const bboWrite = this.style.wrap(String(this.metrics.bboWritten), "bold", "green");
    const bboWriteRate = `${this.style.token("dim")}(${fmtNum(perSec(delta.bboWritten), 1)}/s)${this.style.token("reset")}`;
    const writeRatio =
      this.metrics.bboReceived > 0 ?
        `${this.style.token("dim")}ratio:${this.style.token("reset")} ${fmtNum((this.metrics.bboWritten / this.metrics.bboReceived) * 100, 1)}%`
      : "";

    lines.push(
      this.boxRow(
        `${this.style.token("dim")}BBO:${this.style.token("reset")} recv=${bboRecv} ${bboRecvRate}  write=${bboWrite} ${bboWriteRate}  ${writeRatio}`,
        width,
      ),
    );

    // Other metrics
    const tradeRecv = this.style.wrap(String(this.metrics.tradeReceived), "bold");
    const tradeRate = `${this.style.token("dim")}(${fmtNum(perSec(delta.tradeReceived), 1)}/s)${this.style.token("reset")}`;
    const priceRecv = this.style.wrap(String(this.metrics.priceReceived), "bold");
    const priceRate = `${this.style.token("dim")}(${fmtNum(perSec(delta.priceReceived), 1)}/s)${this.style.token("reset")}`;
    const fundRecv = this.style.wrap(String(this.metrics.fundingReceived), "bold");
    const fundRate = `${this.style.token("dim")}(${fmtNum(perSec(delta.fundingReceived), 2)}/s)${this.style.token("reset")}`;

    lines.push(
      this.boxRow(
        `${this.style.token("dim")}Trade:${this.style.token("reset")} ${tradeRecv} ${tradeRate}  ${this.style.token("dim")}Price:${this.style.token("reset")} ${priceRecv} ${priceRate}  ${this.style.token("dim")}Fund:${this.style.token("reset")} ${fundRecv} ${fundRate}`,
        width,
      ),
    );

    lines.push(this.layout.boxLine(width, "middle"));
    return lines;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Buffers Section
  // ─────────────────────────────────────────────────────────────────────────────

  private renderBuffers(width: number): string[] {
    const lines: string[] = [];

    const sectionTitle = this.style.wrap("BUFFERS", "bold", "cyan");
    lines.push(this.layout.sectionHeader(sectionTitle, width));

    // Buffer sizes with color coding
    const bboStyle =
      this.bufferSizes.bbo > 100 ? "yellow"
      : this.bufferSizes.bbo > 0 ? "green"
      : "dim";
    const tradeStyle =
      this.bufferSizes.trade > 100 ? "yellow"
      : this.bufferSizes.trade > 0 ? "green"
      : "dim";
    const priceStyle =
      this.bufferSizes.price > 100 ? "yellow"
      : this.bufferSizes.price > 0 ? "green"
      : "dim";
    const deadStyle = this.deadLetterSize > 0 ? "red" : "dim";

    const bboVal = this.style.wrap(String(this.bufferSizes.bbo), bboStyle);
    const tradeVal = this.style.wrap(String(this.bufferSizes.trade), tradeStyle);
    const priceVal = this.style.wrap(String(this.bufferSizes.price), priceStyle);
    const deadVal = this.style.wrap(String(this.deadLetterSize), deadStyle);

    lines.push(
      this.boxRow(
        `${this.style.token("dim")}BBO:${this.style.token("reset")} ${bboVal}  ${this.style.token("dim")}Trade:${this.style.token("reset")} ${tradeVal}  ${this.style.token("dim")}Price:${this.style.token("reset")} ${priceVal}  ${this.style.token("dim")}DeadLetter:${this.style.token("reset")} ${deadVal}`,
        width,
      ),
    );

    lines.push(this.layout.boxLine(width, "middle"));
    return lines;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Logs Section
  // ─────────────────────────────────────────────────────────────────────────────

  private renderLogs(width: number): string[] {
    const lines: string[] = [];

    const sectionTitle = this.style.wrap("LOGS", "bold", "cyan");
    lines.push(this.layout.sectionHeader(sectionTitle, width));

    const recentLogs = this.logs.latest(200).slice().reverse().slice(0, 8);

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
        const fullLine = `${timeStr} ${levelBadge} ${msgContent}`;

        lines.push(this.boxRow(fullLine, width));
      }
    }

    lines.push(this.layout.boxLine(width, "bottom"));
    return lines;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helper: Wrap content in box row (with truncation to prevent overflow)
  // ─────────────────────────────────────────────────────────────────────────────

  private boxRow(content: string, width: number): string {
    const innerWidth = Math.max(0, width - 4);
    const visLen = this.layout.visibleLength(content);
    const finalContent = visLen > innerWidth ? this.layout.truncate(content, innerWidth) : content;
    const paddedContent = this.layout.padRight(finalContent, innerWidth);
    return `${BOX.vertical} ${paddedContent} ${BOX.vertical}`;
  }
}
