import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { Style } from "../../src/cli-dashboard/style";

describe("Style", () => {
  describe("color mode", () => {
    test("enables ANSI tokens", () => {
      const s = new Style();
      expect(s.enabled()).toBe(true);
      expect(s.token("red")).toBe("\x1b[31m");
      expect(s.token("reset")).toBe("\x1b[0m");
    });

    test("returns correct ANSI codes for text decorations", () => {
      const s = new Style();
      expect(s.token("bold")).toBe("\x1b[1m");
      expect(s.token("dim")).toBe("\x1b[2m");
      expect(s.token("underline")).toBe("\x1b[4m");
      expect(s.token("inverse")).toBe("\x1b[7m");
    });

    test("returns correct ANSI codes for foreground colors", () => {
      const s = new Style();
      expect(s.token("red")).toBe("\x1b[31m");
      expect(s.token("green")).toBe("\x1b[32m");
      expect(s.token("yellow")).toBe("\x1b[33m");
      expect(s.token("blue")).toBe("\x1b[34m");
      expect(s.token("magenta")).toBe("\x1b[35m");
      expect(s.token("cyan")).toBe("\x1b[36m");
      expect(s.token("gray")).toBe("\x1b[90m");
      expect(s.token("white")).toBe("\x1b[97m");
    });

    test("returns correct ANSI codes for background colors", () => {
      const s = new Style();
      expect(s.token("bgRed")).toBe("\x1b[41m");
      expect(s.token("bgGreen")).toBe("\x1b[42m");
      expect(s.token("bgYellow")).toBe("\x1b[43m");
      expect(s.token("bgBlue")).toBe("\x1b[44m");
      expect(s.token("bgMagenta")).toBe("\x1b[45m");
      expect(s.token("bgCyan")).toBe("\x1b[46m");
      expect(s.token("bgGray")).toBe("\x1b[100m");
    });

    test("combine() concatenates multiple tokens", () => {
      const s = new Style();
      expect(s.combine("bold", "red")).toBe("\x1b[1m\x1b[31m");
      expect(s.combine("bgGreen", "white", "bold")).toBe("\x1b[42m\x1b[97m\x1b[1m");
    });

    test("wrap() adds tokens and reset around text", () => {
      const s = new Style();
      expect(s.wrap("ERROR", "bold", "red")).toBe("\x1b[1m\x1b[31mERROR\x1b[0m");
    });

    test("badge() pads text and applies styles", () => {
      const s = new Style();
      const badge = s.badge("OK", "bgGreen", "white");
      expect(badge).toContain(" OK ");
      expect(badge).toContain("\x1b[42m"); // bgGreen
      expect(badge).toContain("\x1b[97m"); // white
      expect(badge).toContain("\x1b[0m"); // reset at end
    });
  });
});
