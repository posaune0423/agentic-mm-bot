export class LayoutPolicy {
  padRight(text: string, width: number): string {
    // ANSI SGR sequences don't take visual width; ignore them for padding.
    // We avoid regex here to keep lint rules (no-control-regex) happy.
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

    if (visibleLen >= width) return text;
    return text + " ".repeat(width - visibleLen);
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
}
