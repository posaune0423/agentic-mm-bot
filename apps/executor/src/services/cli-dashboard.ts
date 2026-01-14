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

import type { TrackedOrder } from "./order-tracker";
import type { ExecutionAction } from "./execution-planner";

type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "disconnected";
type ExecutorPhase = "IDLE" | "READ" | "DECIDE" | "PLAN" | "EXECUTE" | "PERSIST";

export type TickDebug = {
  nowMs: number;
  snapshot: Snapshot;
  features: Features;
  output: DecideOutput;
  stateBefore: StrategyState;
  stateAfter: StrategyState;
  paramsSetId: string;
  params: StrategyParams;
  position: { size: string; entryPrice?: string; unrealizedPnl?: string; lastUpdateMs: number };
  orders: TrackedOrder[];
  targetQuote?: { bidPx: string; askPx: string; size: string };
  plannedActions: ExecutionAction[];
};

function fmtNum(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "-";
  return n.toFixed(digits);
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

  private readonly style: Style;
  private readonly layout: LayoutPolicy;
  private readonly screen: TTYScreen;
  private readonly renderer: TTYRenderer;
  private readonly logs: LogBuffer;
  private readonly flow: FlowStatusTracker<ExecutorPhase>;

  constructor(args: {
    enabled: boolean;
    exchange: string;
    symbol: string;
    refreshMs?: number;
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

    this.style = new Style({ noColor: cfg.noColor });
    this.layout = new LayoutPolicy();
    this.renderer = new TTYRenderer(chunk => process.stdout.write(chunk));
    this.screen = new TTYScreen({ enabled: this.enabled, write: chunk => process.stdout.write(chunk) });
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
    logger.setSink({ write: r => this.logs.push(r) });

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
    this.conn = status;
    this.connReason = reason;
    const level = status === "disconnected" ? LogLevel.WARN : LogLevel.INFO;
    this.pushEvent(level, `market data: ${status}`, reason ? { reason } : undefined);
  }

  enterPhase(phase: ExecutorPhase, nowMs = Date.now()): void {
    this.flow.enterPhase(phase, nowMs);
  }

  setTick(tick: TickDebug): void {
    this.tick = tick;
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
      `ORDER ${event.status} clientId=${event.clientOrderId}${event.reason ? ` reason=${event.reason}` : ""}`,
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
      data && typeof data === "object" ?
        Object.fromEntries(Object.entries(data as Record<string, unknown>).map(([k, v]) => [k, JSON.stringify(v)]))
      : undefined;
    const r: LogRecord = { tsMs: Date.now(), level, message, fields };
    this.logs.push(r);
  }

  private render(): void {
    if (!this.enabled) return;
    const nowMs = Date.now();

    const statusColor =
      this.conn === "connected" ? this.style.token("green")
      : this.conn === "reconnecting" ? this.style.token("yellow")
      : this.conn === "connecting" ? this.style.token("cyan")
      : this.style.token("red");

    const header =
      `${this.style.token("bold")}Executor Dashboard${this.style.token("reset")}  ` +
      `${this.style.token("dim")}${this.exchange}/${this.symbol}${this.style.token("reset")}  ` +
      `md=${statusColor}${this.conn}${this.style.token("reset")}` +
      (this.connReason ? ` (${this.connReason})` : "") +
      `  uptime=${this.layout.formatDurationMs(Math.floor(process.uptime() * 1000))}`;

    const t = this.tick;

    const flowSnap = this.flow.snapshot();
    const flowLine =
      `FLOW  phase=${flowSnap.phase}  since=${this.layout.formatAgeMs(nowMs, flowSnap.sinceMs)}  ` +
      `lastDur=${flowSnap.lastDurationMs === undefined ? "-" : `${flowSnap.lastDurationMs}ms`}`;

    const marketLines =
      t ?
        (() => {
          const bid = parseFloat(t.snapshot.bestBidPx);
          const ask = parseFloat(t.snapshot.bestAskPx);
          const mid = (bid + ask) / 2;
          const spreadBps = mid > 0 ? ((ask - bid) / mid) * 10000 : null;
          return [
            `MKT   bid ${t.snapshot.bestBidPx} x ${t.snapshot.bestBidSz}   ask ${t.snapshot.bestAskPx} x ${t.snapshot.bestAskSz}   mid ${fmtNum(mid, 2)}   spread ${fmtNum(spreadBps, 2)}bps`,
            `PX    mark=${t.snapshot.markPx ?? "-"}  index=${t.snapshot.indexPx ?? "-"}  dataAge=${this.layout.formatAgeMs(t.nowMs, t.snapshot.lastUpdateMs)}`,
          ];
        })()
      : ["MKT   -", "PX    -"];

    const stratLines =
      t ?
        (() => {
          const mode = t.stateAfter.mode;
          const modeColor =
            mode === "NORMAL" ? this.style.token("green")
            : mode === "DEFENSIVE" ? this.style.token("yellow")
            : this.style.token("red");
          const pauseRemainingMs = t.stateAfter.pauseUntilMs ? Math.max(0, t.stateAfter.pauseUntilMs - t.nowMs) : 0;
          const lastQuoteAgeMs = t.stateAfter.lastQuoteMs ? t.nowMs - t.stateAfter.lastQuoteMs : null;
          const reasons = t.output.reasonCodes.join(",");
          const intents = t.output.intents.map(i => i.type).join(",");
          const q = t.targetQuote;
          return [
            `STR   mode=${modeColor}${mode}${this.style.token("reset")}  reasons=[${reasons}]  intents=[${intents}]  pauseRemain=${pauseRemainingMs}ms  lastQuoteAge=${lastQuoteAgeMs ?? "-"}ms`,
            `PRM   id=${t.paramsSetId}  baseHalf=${t.params.baseHalfSpreadBps}  volGain=${t.params.volSpreadGain}  toxGain=${t.params.toxSpreadGain}  invSkew=${t.params.inventorySkewGain}  qUsd=${t.params.quoteSizeUsd}`,
            q ? `TGT   bid=${q.bidPx}  ask=${q.askPx}  size=${q.size}` : `TGT   -`,
            `FEAT  vol10s=${t.features.realizedVol10s}  tox1s=${t.features.tradeImbalance1s}  markIdxDiv=${t.features.markIndexDivBps}  liq10s=${t.features.liqCount10s}`,
          ];
        })()
      : ["STR   -", "PRM   -", "TGT   -", "FEAT  -"];

    const posLine =
      t ?
        `POS   size=${t.position.size}  entry=${t.position.entryPrice ?? "-"}  uPnL=${t.position.unrealizedPnl ?? "-"}  age=${this.layout.formatAgeMs(t.nowMs, t.position.lastUpdateMs)}`
      : "POS   -";

    const ordersLines =
      t ?
        (() => {
          const orders = [...t.orders];
          const lines: string[] = [];
          if (orders.length === 0) {
            lines.push("ORD   (none)");
            return lines;
          }

          const buys = orders.filter(o => o.side === "buy").sort((a, b) => b.createdAtMs - a.createdAtMs);
          const sells = orders.filter(o => o.side === "sell").sort((a, b) => b.createdAtMs - a.createdAtMs);
          lines.push(`ORD   active=${orders.length}  buy=${buys.length}  sell=${sells.length}`);

          const renderOrder = (o: TrackedOrder) => {
            const c = o.side === "buy" ? this.style.token("green") : this.style.token("red");
            const id = o.clientOrderId.length > 14 ? o.clientOrderId.slice(-14) : o.clientOrderId;
            return `      ${c}${o.side.toUpperCase()}${this.style.token("reset")} px=${o.price} sz=${o.size} filled=${o.filledSize} age=${this.layout.formatAgeMs(t.nowMs, o.createdAtMs)} id=…${id}`;
          };

          // Show both sides to avoid "only buy" confusion (top 3 each).
          for (const o of buys.slice(0, 3)) lines.push(renderOrder(o));
          for (const o of sells.slice(0, 3)) lines.push(renderOrder(o));

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

    const logHeader = `${this.style.token("bold")}Logs${this.style.token("reset")}`;
    const logLines = this.logs
      .latest(300)
      .slice()
      .reverse()
      .slice(0, 12)
      .map(r => {
        const time = new Date(r.tsMs).toISOString().slice(11, 19);
        const c =
          r.level === LogLevel.ERROR ? this.style.token("red")
          : r.level === LogLevel.WARN ? this.style.token("yellow")
          : this.style.token("cyan");
        return this.layout.padRight(`${time} ${c}${r.level}${this.style.token("reset")} ${r.message}`, 140);
      });

    const outLines = [
      header,
      flowLine,
      "",
      ...marketLines,
      "",
      ...stratLines,
      posLine,
      actionsLine,
      "",
      ...ordersLines,
      "",
      logHeader,
      ...logLines,
    ];

    this.renderer.render(outLines);
  }
}
