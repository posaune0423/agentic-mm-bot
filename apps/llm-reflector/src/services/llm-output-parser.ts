/**
 * LLM output parsing helpers (pure functions).
 *
 * - Best-effort: strip common Markdown fences
 * - Extract the first balanced JSON object from arbitrary text
 */

export function extractFirstJsonObject(text: string): string | null {
  const trimmed = text.trim();

  // Strip common Markdown fences if present (best-effort)
  const withoutFences = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  const start = withoutFences.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < withoutFences.length; i++) {
    const ch = withoutFences.charAt(i);

    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === "{") depth++;
    if (ch === "}") depth--;

    if (depth === 0) {
      return withoutFences.slice(start, i + 1);
    }
  }

  return null;
}

/**
 * Normalize "JSON-like" text into strict JSON that `JSON.parse` can handle.
 *
 * - Strips `// ...` and `/* ... *\/` comments (when not inside strings)
 * - Removes trailing commas before `}` / `]` (when not inside strings)
 */
export function normalizeJsonLike(input: string): string {
  // Pass 1: strip comments (outside strings)
  let out = "";
  let inString = false;
  let escape = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input.charAt(i);

    if (inString) {
      out += ch;
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    const next = i + 1 < input.length ? input.charAt(i + 1) : "";

    // Line comment
    if (ch === "/" && next === "/") {
      i += 1;
      while (i + 1 < input.length && input.charAt(i + 1) !== "\n") i += 1;
      continue;
    }

    // Block comment
    if (ch === "/" && next === "*") {
      i += 1;
      while (i + 1 < input.length) {
        if (input.charAt(i) === "*" && input.charAt(i + 1) === "/") {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    out += ch;
  }

  // Pass 2: remove trailing commas (outside strings)
  let out2 = "";
  inString = false;
  escape = false;

  for (let i = 0; i < out.length; i++) {
    const ch = out.charAt(i);

    if (inString) {
      out2 += ch;
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      out2 += ch;
      continue;
    }

    if (ch === ",") {
      let j = i + 1;
      while (j < out.length && /\s/.test(out.charAt(j))) j += 1;
      const nextNonWs = j < out.length ? out.charAt(j) : "";
      if (nextNonWs === "}" || nextNonWs === "]") {
        continue; // drop trailing comma
      }
    }

    out2 += ch;
  }

  return out2.trim();
}

export function parseJsonLenient(jsonText: string): unknown {
  return JSON.parse(normalizeJsonLike(jsonText));
}

export function snippet(text: string, max = 160): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max - 3)}...` : oneLine;
}
