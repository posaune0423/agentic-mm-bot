import { LayoutPolicy, LogBuffer, LogLevel, logger, Style, TTYRenderer, TTYScreen } from "@agentic-mm-bot/utils";

/**
 * CLI dashboard soak test (manual)
 *
 * Purpose:
 * - Stress diff rendering (no full-screen clear loop)
 * - Stress log routing into the dashboard (no stdout collisions)
 *
 * Usage:
 * - `bun scripts/cli-dashboard-soak.ts`
 * - Optional:
 *   - DASHBOARD_SOAK_MS=600000 (default: 10 minutes)
 *   - DASHBOARD_SOAK_REFRESH_MS=200 (default: 200ms)
 */

const durationMs = Number(process.env.DASHBOARD_SOAK_MS ?? 10 * 60 * 1000);
const refreshMs = Number(process.env.DASHBOARD_SOAK_REFRESH_MS ?? 200);

if (!process.stdout.isTTY) {
  // eslint-disable-next-line no-console
  console.error("This soak test must be run in a TTY (not redirected).");
  process.exit(1);
}

const style = new Style({ noColor: false });
const layout = new LayoutPolicy();
const logs = new LogBuffer(200);

logger.setSink({ write: r => logs.push(r) });

const screen = new TTYScreen({ enabled: true, write: chunk => process.stdout.write(chunk) });
const renderer = new TTYRenderer(chunk => process.stdout.write(chunk));

screen.start();
renderer.reset();

const startedAtMs = Date.now();
let tick = 0;

const shutdown = () => {
  clearInterval(loop);
  logger.clearSink();
  screen.stop();
  process.exit(0);
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

const loop = setInterval(() => {
  const nowMs = Date.now();
  tick++;

  // Generate some log noise
  if (tick % 7 === 0) logger.info("soak: heartbeat", { tick });
  if (tick % 41 === 0) logger.warn("soak: warning example", { tick });

  const uptime = layout.formatAgeMs(nowMs, startedAtMs);
  const phase = tick % 2 === 0 ? "RENDER" : "IDLE";
  const changing = (Math.sin(tick / 5) * 1000).toFixed(2);
  const remainingMs = Math.max(0, startedAtMs + durationMs - nowMs);
  const remaining = remainingMs < 1_000 ? `${remainingMs}ms` : `${(remainingMs / 1_000).toFixed(1)}s`;

  const logHeader = `${style.token("bold")}Logs${style.token("reset")}`;
  const logLines = logs
    .latest(200)
    .slice()
    .reverse()
    .slice(0, 12)
    .map(r => {
      const time = new Date(r.tsMs).toISOString().slice(11, 19);
      const c =
        r.level === LogLevel.ERROR ? style.token("red")
        : r.level === LogLevel.WARN ? style.token("yellow")
        : style.token("cyan");
      return layout.padRight(`${time} ${c}${r.level}${style.token("reset")} ${r.message}`, 140);
    });

  const frame = [
    `${style.token("bold")}CLI Dashboard Soak${style.token("reset")}  uptime=${uptime}  refresh=${refreshMs}ms  remaining=${remaining}`,
    `FLOW  phase=${phase}  tick=${tick}`,
    `VAL   changing=${changing}`,
    "",
    logHeader,
    ...logLines,
  ];

  renderer.render(frame);

  if (nowMs - startedAtMs >= durationMs) {
    shutdown();
  }
}, refreshMs);
