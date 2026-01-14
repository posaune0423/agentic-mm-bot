export type StyleToken = "reset" | "dim" | "bold" | "red" | "yellow" | "green" | "cyan";

const ANSI: Record<StyleToken, string> = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
};

export class Style {
  private readonly noColor: boolean;

  constructor(args: { noColor: boolean }) {
    // Respect the de-facto standard env var, in addition to app config.
    this.noColor = args.noColor || process.env.NO_COLOR !== undefined;
  }

  enabled(): boolean {
    return !this.noColor;
  }

  token(t: StyleToken): string {
    if (this.noColor) return "";
    return ANSI[t];
  }
}
