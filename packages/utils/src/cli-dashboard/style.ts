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

function tokenValue(t: StyleToken): string {
  switch (t) {
    case "reset":
      return "\x1B[0m";
    case "dim":
      return "\x1B[2m";
    case "bold":
      return "\x1B[1m";
    case "underline":
      return "\x1B[4m";
    case "inverse":
      return "\x1B[7m";
    case "red":
      return "\x1B[31m";
    case "yellow":
      return "\x1B[33m";
    case "green":
      return "\x1B[32m";
    case "cyan":
      return "\x1B[36m";
    case "blue":
      return "\x1B[34m";
    case "magenta":
      return "\x1B[35m";
    case "gray":
      return "\x1B[90m";
    case "white":
      return "\x1B[97m";
    case "bgRed":
      return "\x1B[41m";
    case "bgYellow":
      return "\x1B[43m";
    case "bgGreen":
      return "\x1B[42m";
    case "bgBlue":
      return "\x1B[44m";
    case "bgCyan":
      return "\x1B[46m";
    case "bgMagenta":
      return "\x1B[45m";
    case "bgGray":
      return "\x1B[100m";
  }
}

export class Style {
  enabled(): boolean {
    return true;
  }

  token(t: StyleToken): string {
    return tokenValue(t);
  }

  /**
   * Combine multiple style tokens into a single string.
   * e.g. style.combine("bold", "red") => "\x1b[1m\x1b[31m"
   */
  combine(...tokens: StyleToken[]): string {
    return tokens.map(tokenValue).join("");
  }

  /**
   * Wrap text with style tokens and auto-reset at end.
   * e.g. style.wrap("ERROR", "bold", "bgRed", "white") => "\x1b[1m\x1b[41m\x1b[97mERROR\x1b[0m"
   */
  wrap(text: string, ...tokens: StyleToken[]): string {
    return this.combine(...tokens) + text + tokenValue("reset");
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
