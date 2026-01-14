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
import type { IngestorMetrics } from "../types";

type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

type BboDecision = {
  shouldWrite: boolean;
  reason: "first_write" | "time_throttle" | "price_change" | "throttled";
  throttleMs: number;
  minChangeBps: number;
  timeSinceLastWriteMs: number;
  lastMid: number | null;
  currentMid: number;
  changeBps: number | null;
};

type DashboardEvent = { ts: number; level: "INFO" | "WARN" | "ERROR"; message: string; data?: unknown };

const ANSI = {
  altScreenOn: "\x1b[?1049h",
  altScreenOff: "\x1b[?1049l",
  clear: "\x1b[2J",
  home: "\x1b[H",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
} as const;

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return n.toFixed(digits);
}

function fmtAgeMs(nowMs: number, ts?: Date | number | null): string {
  const t =
    ts instanceof Date ? ts.getTime()
    : typeof ts === "number" ? ts
    : null;
  if (t === null) return "-";
  const age = Math.max(0, nowMs - t);
  if (age < 1_000) return `${age}ms`;
  if (age < 60_000) return `${(age / 1_000).toFixed(1)}s`;
  return `${(age / 60_000).toFixed(1)}m`;
}

function padRight(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return s + " ".repeat(width - s.length);
}

export class IngestorCliDashboard {
  private readonly enabled: boolean;
  private readonly exchange: string;
  private readonly symbol: string;

  private status: ConnectionStatus = "connecting";
  private statusReason?: string;
  private readonly startedAtMs = Date.now();

  private metrics: IngestorMetrics;
  private lastMetricsSampleAtMs = Date.now();
  private lastMetricsSample: IngestorMetrics;

  private lastBbo?: BboEvent;
  private lastTrade?: TradeEvent;
  private lastPrice?: PriceEvent;
  private lastFunding?: FundingRateEvent;

  private lastBboDecision?: BboDecision;

  private bufferSizes: { bbo: number; trade: number; price: number } = { bbo: 0, trade: 0, price: 0 };
  private deadLetterSize = 0;

  private interval: ReturnType<typeof setInterval> | null = null;
  private events: DashboardEvent[] = [];

  constructor(args: { enabled: boolean; exchange: string; symbol: string; initialMetrics: IngestorMetrics }) {
    this.enabled = args.enabled && Boolean(process.stdout.isTTY);
    this.exchange = args.exchange;
    this.symbol = args.symbol;
    this.metrics = { ...args.initialMetrics };
    this.lastMetricsSample = { ...args.initialMetrics };
  }

  start(): void {
    if (!this.enabled || this.interval) return;
    // Alternate screen buffer avoids corrupting scrollback.
    process.stdout.write(ANSI.altScreenOn + ANSI.hideCursor);
    this.interval = setInterval(() => this.render(), 250);

    const restore = () => {
      this.stop();
    };
    process.once("SIGINT", restore);
    process.once("SIGTERM", restore);
    process.once("exit", () => this.stop());
  }

  stop(): void {
    if (!this.enabled) return;
    if (this.interval) clearInterval(this.interval);
    this.interval = null;
    process.stdout.write(ANSI.showCursor + ANSI.altScreenOff);
  }

  setConnectionStatus(status: ConnectionStatus, reason?: string): void {
    this.status = status;
    this.statusReason = reason;
    this.pushEvent(
      status === "disconnected" ? "WARN" : "INFO",
      `market data: ${status}`,
      reason ? { reason } : undefined,
    );
  }

  setBuffers(args: { bufferSizes: { bbo: number; trade: number; price: number }; deadLetterSize: number }): void {
    this.bufferSizes = args.bufferSizes;
    this.deadLetterSize = args.deadLetterSize;
  }

  setMetrics(metrics: IngestorMetrics): void {
    this.metrics = metrics;
  }

  onBbo(event: BboEvent, decision?: BboDecision): void {
    this.lastBbo = event;
    if (decision) this.lastBboDecision = decision;
  }

  onTrade(event: TradeEvent): void {
    this.lastTrade = event;
  }

  onPrice(event: PriceEvent): void {
    this.lastPrice = event;
  }

  onFunding(event: FundingRateEvent): void {
    this.lastFunding = event;
  }

  pushEvent(level: DashboardEvent["level"], message: string, data?: unknown): void {
    const e: DashboardEvent = { ts: Date.now(), level, message, data };
    this.events.push(e);
    if (this.events.length > 12) this.events = this.events.slice(this.events.length - 12);
  }

  private render(): void {
    if (!this.enabled) return;
    const nowMs = Date.now();

    // rates
    const dtMs = Math.max(1, nowMs - this.lastMetricsSampleAtMs);
    const perSec = (d: number) => (d * 1000) / dtMs;
    const delta = {
      bboReceived: this.metrics.bboReceived - this.lastMetricsSample.bboReceived,
      bboWritten: this.metrics.bboWritten - this.lastMetricsSample.bboWritten,
      tradeReceived: this.metrics.tradeReceived - this.lastMetricsSample.tradeReceived,
      priceReceived: this.metrics.priceReceived - this.lastMetricsSample.priceReceived,
      fundingReceived: this.metrics.fundingReceived - this.lastMetricsSample.fundingReceived,
    };
    // refresh rate snapshot ~1s
    if (dtMs >= 1000) {
      this.lastMetricsSampleAtMs = nowMs;
      this.lastMetricsSample = { ...this.metrics };
    }

    const statusColor =
      this.status === "connected" ? ANSI.green
      : this.status === "reconnecting" ? ANSI.yellow
      : this.status === "connecting" ? ANSI.cyan
      : ANSI.red;

    const header =
      `${ANSI.bold}Ingestor Dashboard${ANSI.reset}  ` +
      `${ANSI.dim}${this.exchange}/${this.symbol}${ANSI.reset}  ` +
      `status=${statusColor}${this.status}${ANSI.reset}` +
      (this.statusReason ? ` (${this.statusReason})` : "") +
      `  uptime=${fmtAgeMs(nowMs, this.startedAtMs)}`;

    const bboLine =
      this.lastBbo ?
        (() => {
          const bid = parseFloat(this.lastBbo.bestBidPx);
          const ask = parseFloat(this.lastBbo.bestAskPx);
          const mid = (bid + ask) / 2;
          const spreadBps = mid > 0 ? ((ask - bid) / mid) * 10000 : null;
          return (
            `BBO   bid ${this.lastBbo.bestBidPx} x ${this.lastBbo.bestBidSz}  ` +
            `ask ${this.lastBbo.bestAskPx} x ${this.lastBbo.bestAskSz}  ` +
            `mid ${fmtNum(mid, 2)}  spread ${fmtNum(spreadBps, 2)}bps  ` +
            `age ${fmtAgeMs(nowMs, this.lastBbo.ts)}`
          );
        })()
      : "BBO   -";

    const bboDecisionLine =
      this.lastBboDecision ?
        (() => {
          const d = this.lastBboDecision;
          const ok = d.shouldWrite ? `${ANSI.green}WRITE${ANSI.reset}` : `${ANSI.dim}skip${ANSI.reset}`;
          const why =
            d.reason === "first_write" ? "first"
            : d.reason === "time_throttle" ? `time>=${d.throttleMs}ms`
            : d.reason === "price_change" ? `Δmid>=${d.minChangeBps}bps`
            : "throttled";
          return (
            `DEC   ${ok}  reason=${why}  ` +
            `since_last_write=${d.timeSinceLastWriteMs}ms  ` +
            `Δbps=${d.changeBps === null ? "-" : fmtNum(d.changeBps, 2)}`
          );
        })()
      : "DEC   -";

    const tradeLine =
      this.lastTrade ?
        `TRD   ${this.lastTrade.side} px=${this.lastTrade.px} sz=${this.lastTrade.sz} type=${this.lastTrade.tradeType} age ${fmtAgeMs(nowMs, this.lastTrade.ts)}`
      : "TRD   -";

    const priceLine =
      this.lastPrice ?
        `PX    type=${this.lastPrice.priceType} mark=${this.lastPrice.markPx ?? "-"} index=${this.lastPrice.indexPx ?? "-"} age ${fmtAgeMs(nowMs, this.lastPrice.ts)}`
      : "PX    -";

    const fundingLine =
      this.lastFunding ?
        `FUND  rate=${this.lastFunding.fundingRate} age ${fmtAgeMs(nowMs, this.lastFunding.ts)}`
      : "FUND  -";

    const countsLine =
      `CNT   bbo recv=${this.metrics.bboReceived} (${fmtNum(perSec(delta.bboReceived), 1)}/s)` +
      `  write=${this.metrics.bboWritten} (${fmtNum(perSec(delta.bboWritten), 1)}/s)` +
      `  trades=${this.metrics.tradeReceived} (${fmtNum(perSec(delta.tradeReceived), 1)}/s)` +
      `  prices=${this.metrics.priceReceived} (${fmtNum(perSec(delta.priceReceived), 1)}/s)` +
      `  funding=${this.metrics.fundingReceived} (${fmtNum(perSec(delta.fundingReceived), 2)}/s)`;

    const buffersLine = `BUF   bbo=${this.bufferSizes.bbo}  trade=${this.bufferSizes.trade}  price=${this.bufferSizes.price}  dead_letter=${this.deadLetterSize}`;

    const evHeader = `${ANSI.bold}Recent events${ANSI.reset}`;
    const evLines = this.events
      .slice()
      .reverse()
      .slice(0, 8)
      .map(e => {
        const t = new Date(e.ts).toISOString().slice(11, 19);
        const c =
          e.level === "ERROR" ? ANSI.red
          : e.level === "WARN" ? ANSI.yellow
          : ANSI.cyan;
        const msg = `${t} ${c}${e.level}${ANSI.reset} ${e.message}`;
        return padRight(msg, 120);
      });

    const outLines = [
      header,
      "",
      bboLine,
      bboDecisionLine,
      tradeLine,
      priceLine,
      fundingLine,
      "",
      countsLine,
      buffersLine,
      "",
      evHeader,
      ...evLines,
    ];

    process.stdout.write(ANSI.clear + ANSI.home + outLines.join("\n") + "\n");
  }
}
