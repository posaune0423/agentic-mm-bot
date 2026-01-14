const ANSI = {
  altScreenOn: "\x1b[?1049h",
  altScreenOff: "\x1b[?1049l",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
} as const;

type RegisterOnce = (event: "SIGINT" | "SIGTERM" | "exit", handler: () => void) => void;

/**
 * Manages entering/leaving the alternate screen buffer and restoring terminal state.
 *
 * Designed to be safe for multiple start/stop calls.
 */
export class TTYScreen {
  private readonly enabled: boolean;
  private readonly write: (chunk: string) => void;
  private readonly once: RegisterOnce;
  private started = false;

  constructor(args: { enabled: boolean; write: (chunk: string) => void; onProcessOnce?: RegisterOnce }) {
    this.enabled = args.enabled;
    this.write = args.write;
    this.once = args.onProcessOnce ?? ((event, handler) => process.once(event, handler));
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  start(): void {
    if (!this.enabled || this.started) return;
    this.started = true;

    // Alternate screen buffer avoids corrupting scrollback.
    this.write(ANSI.altScreenOn + ANSI.hideCursor);

    const restore = () => this.stop();
    this.once("SIGINT", restore);
    this.once("SIGTERM", restore);
    this.once("exit", restore);
  }

  stop(): void {
    if (!this.enabled || !this.started) return;
    this.started = false;
    this.write(ANSI.showCursor + ANSI.altScreenOff);
  }
}
