import { describe, expect, test } from "bun:test";

import { BOX, LayoutPolicy } from "../../src/cli-dashboard/layout-policy";

describe("LayoutPolicy", () => {
  describe("padRight", () => {
    test("pads text to specified width", () => {
      const p = new LayoutPolicy();
      expect(p.padRight("a", 4)).toBe("a   ");
    });

    test("does not truncate text longer than width", () => {
      const p = new LayoutPolicy();
      expect(p.padRight("abcdef", 4)).toBe("abcdef");
    });

    test("ignores ANSI sequences when calculating width", () => {
      const p = new LayoutPolicy();
      const ansiText = "\x1b[31mred\x1b[0m"; // "red" in red color
      const padded = p.padRight(ansiText, 10);
      // Should pad to 10 visible characters (3 + 7 spaces)
      expect(padded).toBe(ansiText + "       ");
    });
  });

  describe("visibleLength", () => {
    test("returns correct length for plain text", () => {
      const p = new LayoutPolicy();
      expect(p.visibleLength("hello")).toBe(5);
      expect(p.visibleLength("")).toBe(0);
    });

    test("ignores ANSI SGR sequences", () => {
      const p = new LayoutPolicy();
      // "\x1b[31m" is red, "\x1b[0m" is reset
      expect(p.visibleLength("\x1b[31mred\x1b[0m")).toBe(3);
      expect(p.visibleLength("\x1b[1m\x1b[31mbold red\x1b[0m")).toBe(8);
    });

    test("handles multiple ANSI sequences", () => {
      const p = new LayoutPolicy();
      const text = "\x1b[32mgreen\x1b[0m \x1b[33myellow\x1b[0m";
      // "green yellow" = 12 characters (5 + 1 + 6)
      expect(p.visibleLength(text)).toBe(12);
    });
  });

  describe("truncate", () => {
    test("returns original text if within width", () => {
      const p = new LayoutPolicy();
      expect(p.truncate("hello", 10)).toBe("hello");
    });

    test("truncates text with ellipsis if exceeds width", () => {
      const p = new LayoutPolicy();
      const result = p.truncate("hello world", 6);
      expect(result).toContain("…");
      expect(p.visibleLength(result)).toBeLessThanOrEqual(6);
    });

    test("preserves ANSI sequences when truncating", () => {
      const p = new LayoutPolicy();
      const ansiText = "\x1b[31mhello world\x1b[0m";
      const result = p.truncate(ansiText, 6);
      // Should contain the red start code and end with reset + ellipsis
      expect(result).toContain("\x1b[31m");
      expect(result).toContain("…");
    });

    test("returns empty string for width 0", () => {
      const p = new LayoutPolicy();
      expect(p.truncate("hello", 0)).toBe("");
    });
  });

  describe("padLeft", () => {
    test("pads text on the left", () => {
      const p = new LayoutPolicy();
      expect(p.padLeft("a", 4)).toBe("   a");
    });

    test("handles ANSI sequences correctly", () => {
      const p = new LayoutPolicy();
      const ansiText = "\x1b[31m5\x1b[0m";
      const padded = p.padLeft(ansiText, 4);
      expect(padded.startsWith("   ")).toBe(true);
      expect(padded).toContain(ansiText);
    });
  });

  describe("center", () => {
    test("centers text within width", () => {
      const p = new LayoutPolicy();
      const result = p.center("hi", 6);
      expect(result).toBe("  hi  ");
    });

    test("handles odd width correctly", () => {
      const p = new LayoutPolicy();
      const result = p.center("hi", 5);
      // Should have 1 space on left, 2 on right (or vice versa)
      expect(result.length).toBe(5);
      expect(result.trim()).toBe("hi");
    });
  });

  describe("box drawing", () => {
    test("boxLine creates correct top border", () => {
      const p = new LayoutPolicy();
      const line = p.boxLine(10, "top");
      expect(line).toBe("┌────────┐");
    });

    test("boxLine creates correct bottom border", () => {
      const p = new LayoutPolicy();
      const line = p.boxLine(10, "bottom");
      expect(line).toBe("└────────┘");
    });

    test("boxLine creates correct middle border", () => {
      const p = new LayoutPolicy();
      const line = p.boxLine(10, "middle");
      expect(line).toBe("├────────┤");
    });

    test("boxContent wraps text with borders", () => {
      const p = new LayoutPolicy();
      const content = p.boxContent("hi", 10);
      expect(content).toBe("│ hi     │");
    });

    test("sectionHeader includes title", () => {
      const p = new LayoutPolicy();
      const header = p.sectionHeader("TEST", 20);
      expect(header).toContain("TEST");
      expect(header.startsWith("┌")).toBe(true);
      expect(header.endsWith("┐")).toBe(true);
    });
  });

  describe("kvPair", () => {
    test("formats key-value pair with fixed key width", () => {
      const p = new LayoutPolicy();
      const result = p.kvPair("Name:", "Alice", 10);
      expect(result).toBe("Name:     Alice");
    });
  });

  describe("tableRow", () => {
    test("formats row with fixed column widths", () => {
      const p = new LayoutPolicy();
      const result = p.tableRow(["A", "B", "C"], [4, 4, 4]);
      expect(result).toBe("A    B    C   ");
    });
  });

  describe("formatAgeMs", () => {
    test("returns '-' for missing ts", () => {
      const p = new LayoutPolicy();
      expect(p.formatAgeMs(1000, undefined)).toBe("-");
      expect(p.formatAgeMs(1000, null)).toBe("-");
    });

    test("formats milliseconds correctly", () => {
      const p = new LayoutPolicy();
      expect(p.formatAgeMs(1500, 1000)).toBe("500ms");
    });

    test("formats seconds correctly", () => {
      const p = new LayoutPolicy();
      expect(p.formatAgeMs(5000, 0)).toContain("s");
    });
  });

  describe("formatDurationMs", () => {
    test("formats milliseconds", () => {
      const p = new LayoutPolicy();
      expect(p.formatDurationMs(500)).toContain("ms");
    });

    test("formats seconds", () => {
      const p = new LayoutPolicy();
      expect(p.formatDurationMs(1500)).toContain("s");
    });

    test("formats minutes", () => {
      const p = new LayoutPolicy();
      expect(p.formatDurationMs(90000)).toContain("m");
    });

    test("formats hours", () => {
      const p = new LayoutPolicy();
      expect(p.formatDurationMs(7200000)).toContain("h");
    });
  });

  describe("BOX constants", () => {
    test("exports box drawing characters", () => {
      expect(BOX.topLeft).toBe("┌");
      expect(BOX.topRight).toBe("┐");
      expect(BOX.bottomLeft).toBe("└");
      expect(BOX.bottomRight).toBe("┘");
      expect(BOX.horizontal).toBe("─");
      expect(BOX.vertical).toBe("│");
    });
  });
});
