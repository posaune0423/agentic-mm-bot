// Unicode box-drawing characters for rich CLI output
export const BOX = {
  topLeft: "┌",
  topRight: "┐",
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
  vertical: "│",
  teeRight: "├",
  teeLeft: "┤",
  teeDown: "┬",
  teeUp: "┴",
  cross: "┼",
} as const;

/** Default terminal width fallback when stdout.columns is unavailable */
const DEFAULT_TERM_WIDTH = 120;

export class LayoutPolicy {
  /**
   * Get current terminal width (or fallback).
   */
  getTerminalWidth(): number {
    return process.stdout.columns || DEFAULT_TERM_WIDTH;
  }

  /**
   * Calculate visible length of text (ignoring ANSI SGR sequences).
   * ANSI SGR sequences don't take visual width.
   */
  visibleLength(text: string): number {
    let visibleLen = 0;
    for (let i = 0; i < text.length; i++) {
      // ESC [
      if (text.charCodeAt(i) === 27 && text[i + 1] === "[") {
        i += 2;
        // Skip until final 'm' (simple SGR)
        while (i < text.length && text[i] !== "m") i++;
        continue;
      }
      visibleLen++;
    }
    return visibleLen;
  }

  /**
   * Truncate text to fit within width, preserving ANSI sequences.
   * Adds ellipsis (…) if truncated.
   */
  truncate(text: string, width: number): string {
    if (width <= 0) return "";
    if (this.visibleLength(text) <= width) return text;

    let result = "";
    let visibleLen = 0;
    const targetWidth = width - 1; // Reserve space for ellipsis

    for (let i = 0; i < text.length; i++) {
      // ESC [
      if (text.charCodeAt(i) === 27 && text[i + 1] === "[") {
        // Capture entire ANSI sequence
        let seq = text[i];
        i++;
        while (i < text.length) {
          seq += text[i];
          if (text[i] === "m") break;
          i++;
        }
        result += seq;
        continue;
      }

      if (visibleLen >= targetWidth) break;
      result += text[i];
      visibleLen++;
    }

    // Add reset before ellipsis to avoid style bleeding
    return result + "\x1b[0m…";
  }

  padRight(text: string, width: number): string {
    const visibleLen = this.visibleLength(text);
    if (visibleLen >= width) return text;
    return text + " ".repeat(width - visibleLen);
  }

  /**
   * Pad text on the left to reach specified width.
   */
  padLeft(text: string, width: number): string {
    const visibleLen = this.visibleLength(text);
    if (visibleLen >= width) return text;
    return " ".repeat(width - visibleLen) + text;
  }

  /**
   * Center text within specified width.
   */
  center(text: string, width: number): string {
    const visibleLen = this.visibleLength(text);
    if (visibleLen >= width) return text;
    const leftPad = Math.floor((width - visibleLen) / 2);
    const rightPad = width - visibleLen - leftPad;
    return " ".repeat(leftPad) + text + " ".repeat(rightPad);
  }

  /**
   * Create a horizontal box border line.
   * @param width - Total width including corners
   * @param type - "top" | "middle" | "bottom"
   */
  boxLine(width: number, type: "top" | "middle" | "bottom"): string {
    const innerWidth = Math.max(0, width - 2);
    const left =
      type === "top" ? BOX.topLeft
      : type === "middle" ? BOX.teeRight
      : BOX.bottomLeft;
    const right =
      type === "top" ? BOX.topRight
      : type === "middle" ? BOX.teeLeft
      : BOX.bottomRight;
    return left + BOX.horizontal.repeat(innerWidth) + right;
  }

  /**
   * Wrap content line with box vertical borders.
   * Truncates content if it exceeds available width.
   * @param content - Content to wrap (can contain ANSI codes)
   * @param width - Total width including borders
   */
  boxContent(content: string, width: number): string {
    const innerWidth = Math.max(0, width - 4); // 2 for borders, 2 for padding
    const visLen = this.visibleLength(content);

    // Truncate if content is too long
    const finalContent = visLen > innerWidth ? this.truncate(content, innerWidth) : content;
    const paddedContent = this.padRight(finalContent, innerWidth);

    return `${BOX.vertical} ${paddedContent} ${BOX.vertical}`;
  }

  /**
   * Create a section header with title in a box.
   * @param title - Section title (can contain ANSI codes)
   * @param width - Total width including borders
   */
  sectionHeader(title: string, width: number): string {
    // Total width = ┌ + (dashes + space + title + space + dashes) + ┐
    // Inner content width = width - 2 (for corners)
    const innerWidth = Math.max(0, width - 2);
    const titleLen = this.visibleLength(title);

    // Minimum: ┌─ TITLE ─┐ (need at least 1 dash each side + spaces)
    const minTitleSpace = titleLen + 4; // 2 spaces + 2 dashes minimum

    if (minTitleSpace >= innerWidth) {
      // Title too long, truncate it
      const maxTitleLen = Math.max(1, innerWidth - 4);
      const truncTitle = titleLen > maxTitleLen ? this.truncate(title, maxTitleLen) : title;
      const truncLen = this.visibleLength(truncTitle);
      const remaining = Math.max(0, innerWidth - truncLen - 2);
      const left = Math.floor(remaining / 2);
      const right = remaining - left;
      return (
        BOX.topLeft + BOX.horizontal.repeat(left) + " " + truncTitle + " " + BOX.horizontal.repeat(right) + BOX.topRight
      );
    }

    // Normal case: center title with dashes
    const remaining = innerWidth - titleLen - 2; // 2 for spaces around title
    const leftDash = Math.max(1, Math.floor(remaining / 2));
    const rightDash = Math.max(1, remaining - leftDash);

    return (
      BOX.topLeft +
      BOX.horizontal.repeat(leftDash) +
      " " +
      title +
      " " +
      BOX.horizontal.repeat(rightDash) +
      BOX.topRight
    );
  }

  formatAgeMs(nowMs: number, tsMs?: number | null): string {
    if (tsMs === null || tsMs === undefined) return "-";
    const age = Math.max(0, nowMs - tsMs);
    if (age < 1_000) return `${age}ms`;
    if (age < 60_000) return `${(age / 1_000).toFixed(1)}s`;
    return `${(age / 60_000).toFixed(1)}m`;
  }

  /**
   * Monotonic-ish duration formatting (stable width-ish for dashboards).
   * Use for uptime / elapsed timers (not absolute timestamps).
   */
  formatDurationMs(durationMs: number): string {
    const d = Math.max(0, durationMs);
    const s =
      d < 1_000 ? `${d}ms`
      : d < 60_000 ? `${(d / 1_000).toFixed(1)}s`
      : d < 3_600_000 ? `${(d / 60_000).toFixed(1)}m`
      : `${(d / 3_600_000).toFixed(1)}h`;
    return s.padStart(6, " ");
  }

  /**
   * Format a key-value pair with alignment.
   * @param key - Label
   * @param value - Value (can contain ANSI)
   * @param keyWidth - Fixed width for key column
   */
  kvPair(key: string, value: string, keyWidth: number): string {
    return this.padRight(key, keyWidth) + value;
  }

  /**
   * Create a simple table row with fixed column widths.
   * @param cells - Array of cell contents
   * @param widths - Array of column widths
   * @param separator - Optional separator between cells (default: " ")
   */
  tableRow(cells: string[], widths: number[], separator = " "): string {
    return cells.map((cell, i) => this.padRight(cell, widths[i] ?? 10)).join(separator);
  }
}
