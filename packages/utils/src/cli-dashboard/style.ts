export type StyleToken =
  // Reset & text decorations
  | "reset"
  | "dim"
  | "bold"
  | "underline"
  | "inverse"
  // Foreground colors
  | "red"
  | "yellow"
  | "green"
  | "cyan"
  | "blue"
  | "magenta"
  | "gray"
  | "white"
  // Background colors (for badges/highlights)
  | "bgRed"
  | "bgYellow"
  | "bgGreen"
  | "bgBlue"
  | "bgCyan"
  | "bgMagenta"
  | "bgGray";

const ANSI: Record<StyleToken, string> = {
  // Reset & text decorations
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  underline: "\x1b[4m",
  inverse: "\x1b[7m",
  // Foreground colors
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
  white: "\x1b[97m",
  // Background colors
  bgRed: "\x1b[41m",
  bgYellow: "\x1b[43m",
  bgGreen: "\x1b[42m",
  bgBlue: "\x1b[44m",
  bgCyan: "\x1b[46m",
  bgMagenta: "\x1b[45m",
  bgGray: "\x1b[100m",
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

  /**
   * Combine multiple style tokens into a single string.
   * e.g. style.combine("bold", "red") => "\x1b[1m\x1b[31m"
   */
  combine(...tokens: StyleToken[]): string {
    if (this.noColor) return "";
    return tokens.map(t => ANSI[t]).join("");
  }

  /**
   * Wrap text with style tokens and auto-reset at end.
   * e.g. style.wrap("ERROR", "bold", "bgRed", "white") => "\x1b[1m\x1b[41m\x1b[97mERROR\x1b[0m"
   */
  wrap(text: string, ...tokens: StyleToken[]): string {
    if (this.noColor) return text;
    return this.combine(...tokens) + text + ANSI.reset;
  }

  /**
   * Create a styled "badge" with padding (for status indicators).
   * e.g. style.badge("OK", "bgGreen", "white", "bold") => " OK "
   */
  badge(text: string, ...tokens: StyleToken[]): string {
    const padded = ` ${text} `;
    return this.wrap(padded, ...tokens);
  }
}
