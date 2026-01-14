/**
 * Executor CLI Dashboard (TTY UI)
 *
 * Goal: From a single terminal screen, always know:
 * - Current market prices (BBO/mid/spread, mark/index) and data age
 * - Current strategy mode + latest decision (reason codes, intents, target quote)
 * - What orders are currently live (price/size/age) vs target quote
 * - Recent actions (place/cancel/cancel_all, fills, rejects)
 */
import type { DecideOutput, Features, Snapshot, StrategyState } from "@agentic-mm-bot/core";
import type { ExecutionEvent } from "@agentic-mm-bot/adapters";

import type { TrackedOrder } from "./order-tracker";
import type { ExecutionAction } from "./execution-planner";

type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

type DashboardEvent = {
  ts: number;
  level: "INFO" | "WARN" | "ERROR";
  message: string;
  data?: unknown;
};

export type TickDebug = {
  nowMs: number;
  snapshot: Snapshot;
  features: Features;
  output: DecideOutput;
  stateBefore: StrategyState;
  stateAfter: StrategyState;
  position: { size: string; entryPrice?: string; unrealizedPnl?: string; lastUpdateMs: number };
  orders: TrackedOrder[];
  targetQuote?: { bidPx: string; askPx: string; size: string };
  plannedActions: ExecutionAction[];
};

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

function fmtAgeMs(nowMs: number, ts?: number | Date | null): string {
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

function orderSideColor(side: "buy" | "sell"): string {
  return side === "buy" ? ANSI.green : ANSI.red;
}

export class ExecutorCliDashboard {
  private readonly enabled: boolean;
  private readonly exchange: string;
  private readonly symbol: string;

  private readonly startedAtMs = Date.now();
  private interval: ReturnType<typeof setInterval> | null = null;

  private conn: ConnectionStatus = "connecting";
  private connReason?: string;

  private tick?: TickDebug;
  private events: DashboardEvent[] = [];

  constructor(args: { enabled: boolean; exchange: string; symbol: string }) {
    this.enabled = args.enabled && Boolean(process.stdout.isTTY);
    this.exchange = args.exchange;
    this.symbol = args.symbol;
  }

  start(): void {
    if (!this.enabled || this.interval) return;
    process.stdout.write(ANSI.altScreenOn + ANSI.hideCursor);
    this.interval = setInterval(() => this.render(), 250);

    const restore = () => this.stop();
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
    this.conn = status;
    this.connReason = reason;
    const level: DashboardEvent["level"] = status === "disconnected" ? "WARN" : "INFO";
    this.pushEvent(level, `market data: ${status}`, reason ? { reason } : undefined);
  }

  setTick(tick: TickDebug): void {
    this.tick = tick;
  }

  onExecutionEvent(event: ExecutionEvent): void {
    if (event.type === "fill") {
      this.pushEvent("INFO", `FILL ${event.side} px=${event.price} sz=${event.size} ${event.liquidity ?? ""}`.trim(), {
        exchangeOrderId: event.exchangeOrderId,
      });
      return;
    }
    this.pushEvent(
      event.status === "rejected" ? "WARN" : "INFO",
      `ORDER ${event.status} clientId=${event.clientOrderId}${event.reason ? ` reason=${event.reason}` : ""}`,
      { exchangeOrderId: event.exchangeOrderId },
    );
  }

  onAction(phase: "start" | "ok" | "err", action: ExecutionAction, extra?: { error?: unknown }): void {
    const msg =
      action.type === "cancel_all" ? "CANCEL_ALL"
      : action.type === "cancel" ? `CANCEL ${action.clientOrderId}`
      : `PLACE ${action.side} px=${action.price} sz=${action.size}`;
    const lvl: DashboardEvent["level"] =
      phase === "err" ? "ERROR"
      : action.type === "place" ? "INFO"
      : "INFO";
    this.pushEvent(lvl, `${phase.toUpperCase()} ${msg}`, extra);
  }

  pushEvent(level: DashboardEvent["level"], message: string, data?: unknown): void {
    this.events.push({ ts: Date.now(), level, message, data });
    if (this.events.length > 14) this.events = this.events.slice(this.events.length - 14);
  }

  private render(): void {
    if (!this.enabled) return;
    const nowMs = Date.now();

    const statusColor =
      this.conn === "connected" ? ANSI.green
      : this.conn === "reconnecting" ? ANSI.yellow
      : this.conn === "connecting" ? ANSI.cyan
      : ANSI.red;

    const header =
      `${ANSI.bold}Executor Dashboard${ANSI.reset}  ` +
      `${ANSI.dim}${this.exchange}/${this.symbol}${ANSI.reset}  ` +
      `md=${statusColor}${this.conn}${ANSI.reset}` +
      (this.connReason ? ` (${this.connReason})` : "") +
      `  uptime=${fmtAgeMs(nowMs, this.startedAtMs)}`;

    const t = this.tick;

    const marketLines =
      t ?
        (() => {
          const bid = parseFloat(t.snapshot.bestBidPx);
          const ask = parseFloat(t.snapshot.bestAskPx);
          const mid = (bid + ask) / 2;
          const spreadBps = mid > 0 ? ((ask - bid) / mid) * 10000 : null;
          return [
            `MKT   bid ${t.snapshot.bestBidPx} x ${t.snapshot.bestBidSz}   ask ${t.snapshot.bestAskPx} x ${t.snapshot.bestAskSz}   mid ${fmtNum(mid, 2)}   spread ${fmtNum(spreadBps, 2)}bps`,
            `PX    mark=${t.snapshot.markPx ?? "-"}  index=${t.snapshot.indexPx ?? "-"}  dataAge=${fmtAgeMs(t.nowMs, t.snapshot.lastUpdateMs)}`,
          ];
        })()
      : ["MKT   -", "PX    -"];

    const stratLines =
      t ?
        (() => {
          const mode = t.stateAfter.mode;
          const modeColor =
            mode === "NORMAL" ? ANSI.green
            : mode === "DEFENSIVE" ? ANSI.yellow
            : ANSI.red;
          const pauseRemainingMs = t.stateAfter.pauseUntilMs ? Math.max(0, t.stateAfter.pauseUntilMs - t.nowMs) : 0;
          const lastQuoteAgeMs = t.stateAfter.lastQuoteMs ? t.nowMs - t.stateAfter.lastQuoteMs : null;
          const reasons = t.output.reasonCodes.join(",");
          const intents = t.output.intents.map(i => i.type).join(",");
          const q = t.targetQuote;
          return [
            `STR   mode=${modeColor}${mode}${ANSI.reset}  reasons=[${reasons}]  intents=[${intents}]  pauseRemain=${pauseRemainingMs}ms  lastQuoteAge=${lastQuoteAgeMs ?? "-"}ms`,
            q ? `TGT   bid=${q.bidPx}  ask=${q.askPx}  size=${q.size}` : `TGT   -`,
            `FEAT  vol10s=${t.features.realizedVol10s}  tox1s=${t.features.tradeImbalance1s}  markIdxDiv=${t.features.markIndexDivBps}  liq10s=${t.features.liqCount10s}`,
          ];
        })()
      : ["STR   -", "TGT   -", "FEAT  -"];

    const posLine =
      t ?
        `POS   size=${t.position.size}  entry=${t.position.entryPrice ?? "-"}  uPnL=${t.position.unrealizedPnl ?? "-"}  age=${fmtAgeMs(t.nowMs, t.position.lastUpdateMs)}`
      : "POS   -";

    const ordersLines =
      t ?
        (() => {
          const orders = [...t.orders].sort((a, b) => a.side.localeCompare(b.side));
          const lines: string[] = [];
          if (orders.length === 0) {
            lines.push("ORD   (none)");
            return lines;
          }
          lines.push(`ORD   active=${orders.length}`);
          for (const o of orders.slice(0, 6)) {
            const c = orderSideColor(o.side);
            const id = o.clientOrderId.length > 14 ? o.clientOrderId.slice(-14) : o.clientOrderId;
            lines.push(
              `      ${c}${o.side.toUpperCase()}${ANSI.reset} px=${o.price} sz=${o.size} filled=${o.filledSize} age=${fmtAgeMs(t.nowMs, o.createdAtMs)} id=…${id}`,
            );
          }
          return lines;
        })()
      : ["ORD   -"];

    const actionsLine =
      t && t.plannedActions.length > 0 ?
        `PLAN  ${t.plannedActions
          .map(a =>
            a.type === "cancel_all" ? "cancel_all"
            : a.type === "cancel" ? `cancel(${a.clientOrderId})`
            : `place(${a.side}@${a.price})`,
          )
          .join(" -> ")}`
      : "PLAN  -";

    const evHeader = `${ANSI.bold}Recent actions/events${ANSI.reset}`;
    const evLines = this.events
      .slice()
      .reverse()
      .slice(0, 10)
      .map(e => {
        const time = new Date(e.ts).toISOString().slice(11, 19);
        const c =
          e.level === "ERROR" ? ANSI.red
          : e.level === "WARN" ? ANSI.yellow
          : ANSI.cyan;
        return padRight(`${time} ${c}${e.level}${ANSI.reset} ${e.message}`, 140);
      });

    const outLines = [
      header,
      "",
      ...marketLines,
      "",
      ...stratLines,
      posLine,
      actionsLine,
      "",
      ...ordersLines,
      "",
      evHeader,
      ...evLines,
    ];

    process.stdout.write(ANSI.clear + ANSI.home + outLines.join("\n") + "\n");
  }
}
