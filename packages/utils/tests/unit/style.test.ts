import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { Style } from "../../src/cli-dashboard/style";

describe("Style", () => {
  describe("noColor mode", () => {
    test("disables ANSI tokens when noColor is true", () => {
      const s = new Style({ noColor: true });
      expect(s.enabled()).toBe(false);
      expect(s.token("red")).toBe("");
      expect(s.token("reset")).toBe("");
    });

    test("disables all extended tokens when noColor is true", () => {
      const s = new Style({ noColor: true });
      expect(s.token("underline")).toBe("");
      expect(s.token("inverse")).toBe("");
      expect(s.token("bgRed")).toBe("");
      expect(s.token("bgGreen")).toBe("");
      expect(s.token("magenta")).toBe("");
      expect(s.token("gray")).toBe("");
    });

    test("combine() returns empty string when noColor is true", () => {
      const s = new Style({ noColor: true });
      expect(s.combine("bold", "red")).toBe("");
    });

    test("wrap() returns plain text when noColor is true", () => {
      const s = new Style({ noColor: true });
      expect(s.wrap("hello", "bold", "red")).toBe("hello");
    });

    test("badge() returns padded text without styles when noColor is true", () => {
      const s = new Style({ noColor: true });
      expect(s.badge("OK", "bgGreen", "white")).toBe(" OK ");
    });
  });

  describe("color mode", () => {
    // The Style class respects the NO_COLOR env var (de-facto standard).
    // We need to temporarily unset it for these tests.
    let originalNoColor: string | undefined;

    beforeEach(() => {
      originalNoColor = process.env.NO_COLOR;
      delete process.env.NO_COLOR;
    });

    afterEach(() => {
      if (originalNoColor !== undefined) {
        process.env.NO_COLOR = originalNoColor;
      } else {
        delete process.env.NO_COLOR;
      }
    });

    test("enables ANSI tokens when noColor is false and NO_COLOR env is unset", () => {
      const s = new Style({ noColor: false });
      expect(s.enabled()).toBe(true);
      expect(s.token("red")).toBe("\x1b[31m");
      expect(s.token("reset")).toBe("\x1b[0m");
    });

    test("returns correct ANSI codes for text decorations", () => {
      const s = new Style({ noColor: false });
      expect(s.token("bold")).toBe("\x1b[1m");
      expect(s.token("dim")).toBe("\x1b[2m");
      expect(s.token("underline")).toBe("\x1b[4m");
      expect(s.token("inverse")).toBe("\x1b[7m");
    });

    test("returns correct ANSI codes for foreground colors", () => {
      const s = new Style({ noColor: false });
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
      const s = new Style({ noColor: false });
      expect(s.token("bgRed")).toBe("\x1b[41m");
      expect(s.token("bgGreen")).toBe("\x1b[42m");
      expect(s.token("bgYellow")).toBe("\x1b[43m");
      expect(s.token("bgBlue")).toBe("\x1b[44m");
      expect(s.token("bgMagenta")).toBe("\x1b[45m");
      expect(s.token("bgCyan")).toBe("\x1b[46m");
      expect(s.token("bgGray")).toBe("\x1b[100m");
    });

    test("combine() concatenates multiple tokens", () => {
      const s = new Style({ noColor: false });
      expect(s.combine("bold", "red")).toBe("\x1b[1m\x1b[31m");
      expect(s.combine("bgGreen", "white", "bold")).toBe("\x1b[42m\x1b[97m\x1b[1m");
    });

    test("wrap() adds tokens and reset around text", () => {
      const s = new Style({ noColor: false });
      expect(s.wrap("ERROR", "bold", "red")).toBe("\x1b[1m\x1b[31mERROR\x1b[0m");
    });

    test("badge() pads text and applies styles", () => {
      const s = new Style({ noColor: false });
      const badge = s.badge("OK", "bgGreen", "white");
      expect(badge).toContain(" OK ");
      expect(badge).toContain("\x1b[42m"); // bgGreen
      expect(badge).toContain("\x1b[97m"); // white
      expect(badge).toContain("\x1b[0m"); // reset at end
    });
  });

  describe("NO_COLOR environment variable", () => {
    test("respects NO_COLOR env var even when noColor option is false", () => {
      const originalNoColor = process.env.NO_COLOR;
      process.env.NO_COLOR = "1";
      try {
        const s = new Style({ noColor: false });
        expect(s.enabled()).toBe(false);
        expect(s.token("red")).toBe("");
      } finally {
        if (originalNoColor !== undefined) {
          process.env.NO_COLOR = originalNoColor;
        } else {
          delete process.env.NO_COLOR;
        }
      }
    });
  });
});
