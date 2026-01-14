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
  createDashboardControl,
  FlowStatusTracker,
  LayoutPolicy,
  LogBuffer,
  LogLevel,
  logger,
  Style,
  TTYRenderer,
  TTYScreen,
  type LogRecord,
} from "@agentic-mm-bot/utils";
import type { IngestorMetrics } from "../types";

type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";
type IngestorPhase = "IDLE" | "CONNECTING" | "SUBSCRIBED" | "RECEIVING" | "FLUSHING";

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

  private bufferSizes: { bbo: number; trade: number; price: number } = { bbo: 0, trade: 0, price: 0 };
  private deadLetterSize = 0;

  private interval: ReturnType<typeof setInterval> | null = null;

  constructor(args: {
    enabled: boolean;
    exchange: string;
    symbol: string;
    initialMetrics: IngestorMetrics;
    refreshMs?: number;
    staleMs?: number;
    noColor?: boolean;
    maxLogs?: number;
  }) {
    const control = createDashboardControl({
      enabled: args.enabled,
      refreshMs: args.refreshMs ?? 250,
      noColor: args.noColor ?? false,
      isTTY: Boolean(process.stdout.isTTY),
    });
    const cfg = control.config();

    this.enabled = cfg.enabled;
    this.exchange = args.exchange;
    this.symbol = args.symbol;
    this.refreshMs = cfg.refreshMs;
    this.staleMs = args.staleMs ?? 3_000;

    this.style = new Style({ noColor: cfg.noColor });
    this.layout = new LayoutPolicy();
    this.renderer = new TTYRenderer(chunk => process.stdout.write(chunk));
    this.screen = new TTYScreen({ enabled: this.enabled, write: chunk => process.stdout.write(chunk) });
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
    logger.setSink({ write: r => this.logs.push(r) });

    // Render loop: snapshot-only, never blocks hot paths.
    this.interval = setInterval(() => this.render(), this.refreshMs);
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
      data && typeof data === "object" ?
        Object.fromEntries(Object.entries(data as Record<string, unknown>).map(([k, v]) => [k, JSON.stringify(v)]))
      : undefined;
    const r: LogRecord = { tsMs: Date.now(), level, message, fields };
    this.logs.push(r);
  }

  private render(): void {
    if (!this.enabled) return;
    const nowMs = Date.now();

    // Derive IDLE based on receive quietness (helps distinguish quiet vs stuck).
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
    } else {
      // Best-effort: if we're connected and receiving recently, call it RECEIVING.
      if (this.status === "connected" || this.status === "reconnecting") {
        this.flow.enterPhase("RECEIVING", nowMs);
      }
    }

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
      this.status === "connected" ? this.style.token("green")
      : this.status === "reconnecting" ? this.style.token("yellow")
      : this.status === "connecting" ? this.style.token("cyan")
      : this.style.token("red");

    const header =
      `${this.style.token("bold")}Ingestor Dashboard${this.style.token("reset")}  ` +
      `${this.style.token("dim")}${this.exchange}/${this.symbol}${this.style.token("reset")}  ` +
      `status=${statusColor}${this.status}${this.style.token("reset")}` +
      (this.statusReason ? ` (${this.statusReason})` : "") +
      `  uptime=${this.layout.formatDurationMs(Math.floor(process.uptime() * 1000))}`;

    const flowSnap = this.flow.snapshot();
    const flowLine =
      `FLOW  phase=${flowSnap.phase}  since=${this.layout.formatAgeMs(nowMs, flowSnap.sinceMs)}` +
      `  lastDur=${flowSnap.lastDurationMs === undefined ? "-" : `${flowSnap.lastDurationMs}ms`}` +
      `  quiet=${quietMs}ms`;

    const bboLine =
      this.lastBbo ?
        (() => {
          const bid = parseFloat(this.lastBbo.bestBidPx);
          const ask = parseFloat(this.lastBbo.bestAskPx);
          const mid = (bid + ask) / 2;
          const spreadBps = mid > 0 ? ((ask - bid) / mid) * 10000 : null;
          const ageMs = nowMs - this.lastBbo.ts.getTime();
          const stale = ageMs >= this.staleMs;
          const staleTok = stale ? this.style.token("yellow") : "";
          return (
            `BBO   bid ${this.lastBbo.bestBidPx} x ${this.lastBbo.bestBidSz}  ` +
            `ask ${this.lastBbo.bestAskPx} x ${this.lastBbo.bestAskSz}  ` +
            `mid ${fmtNum(mid, 2)}  spread ${fmtNum(spreadBps, 2)}bps  ` +
            `age ${staleTok}${this.layout.formatAgeMs(nowMs, this.lastBbo.ts.getTime())}${this.style.token("reset")}`
          );
        })()
      : "BBO   -";

    const bboDecisionLine =
      this.lastBboDecision ?
        (() => {
          const d = this.lastBboDecision;
          const ok =
            d.shouldWrite ?
              `${this.style.token("green")}WRITE${this.style.token("reset")}`
            : `${this.style.token("dim")}skip${this.style.token("reset")}`;
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
        `TRD   ${this.lastTrade.side} px=${this.lastTrade.px} sz=${this.lastTrade.sz} type=${this.lastTrade.tradeType} age ${this.layout.formatAgeMs(nowMs, this.lastTrade.ts.getTime())}`
      : "TRD   -";

    const priceLine =
      this.lastPrice ?
        `PX    type=${this.lastPrice.priceType} mark=${this.lastPrice.markPx ?? "-"} index=${this.lastPrice.indexPx ?? "-"} age ${this.layout.formatAgeMs(nowMs, this.lastPrice.ts.getTime())}`
      : "PX    -";

    const fundingLine =
      this.lastFunding ?
        `FUND  rate=${this.lastFunding.fundingRate} age ${this.layout.formatAgeMs(nowMs, this.lastFunding.ts.getTime())}`
      : "FUND  -";

    const countsLine =
      `CNT   bbo recv=${this.metrics.bboReceived} (${fmtNum(perSec(delta.bboReceived), 1)}/s)` +
      `  write=${this.metrics.bboWritten} (${fmtNum(perSec(delta.bboWritten), 1)}/s)` +
      `  trades=${this.metrics.tradeReceived} (${fmtNum(perSec(delta.tradeReceived), 1)}/s)` +
      `  prices=${this.metrics.priceReceived} (${fmtNum(perSec(delta.priceReceived), 1)}/s)` +
      `  funding=${this.metrics.fundingReceived} (${fmtNum(perSec(delta.fundingReceived), 2)}/s)`;

    const buffersLine = `BUF   bbo=${this.bufferSizes.bbo}  trade=${this.bufferSizes.trade}  price=${this.bufferSizes.price}  dead_letter=${this.deadLetterSize}`;

    const logHeader = `${this.style.token("bold")}Logs${this.style.token("reset")}`;
    const logLines = this.logs
      .latest(200)
      .slice()
      .reverse()
      .slice(0, 10)
      .map(r => {
        const t = new Date(r.tsMs).toISOString().slice(11, 19);
        const c =
          r.level === LogLevel.ERROR ? this.style.token("red")
          : r.level === LogLevel.WARN ? this.style.token("yellow")
          : this.style.token("cyan");
        const msg = `${t} ${c}${r.level}${this.style.token("reset")} ${r.message}`;
        return this.layout.padRight(msg, 140);
      });

    const outLines: string[] = [
      header,
      flowLine,
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
      logHeader,
      ...logLines,
    ];

    this.renderer.render(outLines);
  }
}
