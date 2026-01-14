type RenderFrame = ReadonlyArray<string>;

import { LayoutPolicy } from "./layout-policy";

const ANSI = {
  // Cursor position: CUP row;col
  cup: (row: number, col: number) => `\x1b[${row};${col}H`,
  // Erase entire line
  eraseLine: "\x1b[2K",
} as const;

/**
 * Minimal diff renderer that updates only changed lines.
 *
 * It intentionally avoids full-screen clears on every frame to prevent flicker.
 */
export class TTYRenderer {
  private prev: string[] = [];
  private readonly write: (chunk: string) => void;
  private readonly layout = new LayoutPolicy();

  constructor(write: (chunk: string) => void) {
    this.write = write;
  }

  reset(): void {
    this.prev = [];
  }

  private normalizeLine(line: string, maxCols: number): string {
    // Ensure one frame line maps to exactly one terminal line:
    // - Replace newlines/tabs with spaces (never emit CR/LF).
    // - Remove other control chars (except ESC, which we keep for ANSI SGR).
    let s = "";
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const code = ch.charCodeAt(0);

      // Normalize hard line breaks (including Unicode line separators).
      if (ch === "\n" || ch === "\r" || ch === "\t" || ch === "\u2028" || ch === "\u2029") {
        s += " ";
        continue;
      }

      // Drop other C0 controls + DEL, but keep ESC for ANSI sequences.
      if ((code >= 0 && code < 32 && code !== 27) || code === 127) continue;

      s += ch;
    }

    // Clamp to current terminal width to prevent auto-wrap corrupting layout.
    if (maxCols > 0 && this.layout.visibleLength(s) > maxCols) {
      s = this.layout.truncate(s, maxCols);
    }

    return s;
  }

  render(frame: RenderFrame): void {
    const cols = process.stdout.columns || 120;
    const next = frame.map(line => this.normalizeLine(line, cols));

    const maxLines = Math.max(this.prev.length, next.length);
    const chunks: string[] = [];

    for (let i = 0; i < maxLines; i++) {
      const prevLine = this.prev[i];
      const nextLine = next[i];

      if (i >= next.length) {
        // Clear removed line.
        chunks.push(ANSI.cup(i + 1, 1), ANSI.eraseLine);
        continue;
      }

      if (prevLine === nextLine) continue;

      chunks.push(ANSI.cup(i + 1, 1), ANSI.eraseLine, nextLine);
    }

    if (chunks.length === 0) return;

    this.prev = next;
    this.write(chunks.join(""));
  }
}
