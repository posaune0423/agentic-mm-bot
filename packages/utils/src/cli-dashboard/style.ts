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
  reset: "\x1B[0m",
  dim: "\x1B[2m",
  bold: "\x1B[1m",
  underline: "\x1B[4m",
  inverse: "\x1B[7m",
  // Foreground colors
  red: "\x1B[31m",
  yellow: "\x1B[33m",
  green: "\x1B[32m",
  cyan: "\x1B[36m",
  blue: "\x1B[34m",
  magenta: "\x1B[35m",
  gray: "\x1B[90m",
  white: "\x1B[97m",
  // Background colors
  bgRed: "\x1B[41m",
  bgYellow: "\x1B[43m",
  bgGreen: "\x1B[42m",
  bgBlue: "\x1B[44m",
  bgCyan: "\x1B[46m",
  bgMagenta: "\x1B[45m",
  bgGray: "\x1B[100m",
};

export class Style {
  enabled(): boolean {
    return true;
  }

  token(t: StyleToken): string {
    return ANSI[t];
  }

  /**
   * Combine multiple style tokens into a single string.
   * e.g. style.combine("bold", "red") => "\x1b[1m\x1b[31m"
   */
  combine(...tokens: StyleToken[]): string {
    return tokens.map(t => ANSI[t]).join("");
  }

  /**
   * Wrap text with style tokens and auto-reset at end.
   * e.g. style.wrap("ERROR", "bold", "bgRed", "white") => "\x1b[1m\x1b[41m\x1b[97mERROR\x1b[0m"
   */
  wrap(text: string, ...tokens: StyleToken[]): string {
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
