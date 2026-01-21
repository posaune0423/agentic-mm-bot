/**
 * CSV Writer - Write backtest fills to CSV file
 *
 * Requirements: 11.4
 * - Output fills as CSV with markout
 */

import type { EnrichedFill } from "./markout";

/**
 * CSV header columns
 */
const CSV_HEADERS = ["ts", "side", "order_px", "sz", "mid_t0", "mid_t10s", "markout_10s_bps", "mode", "reason_codes"];

/**
 * Format a date to ISO string
 */
function formatDate(date: Date): string {
  return date.toISOString();
}

/**
 * Escape CSV value
 */
function escapeCsv(value: string | number | null): string {
  if (value === null) {
    return "";
  }

  const str = String(value);

  // Escape quotes and wrap in quotes if contains comma, quote, or newline
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

/**
 * Convert enriched fill to CSV row
 */
function fillToCsvRow(fill: EnrichedFill): string {
  const values = [
    formatDate(fill.ts),
    fill.side,
    fill.orderPx,
    fill.size,
    fill.midT0,
    fill.midT10s ?? "",
    fill.markout10sBps?.toFixed(4) ?? "",
    fill.mode,
    fill.reasonCodes,
  ];

  return values.map(escapeCsv).join(",");
}

/**
 * Write fills to CSV file
 *
 * @param fills - Enriched fills with markout
 * @param outputPath - Output file path
 */
export async function writeFillsCsv(fills: EnrichedFill[], outputPath: string): Promise<void> {
  const lines: string[] = [];

  // Header
  lines.push(CSV_HEADERS.join(","));

  // Data rows
  for (const fill of fills) {
    lines.push(fillToCsvRow(fill));
  }

  // Write to file
  // Use Bun APIs to avoid non-literal-fs-filename lint warnings.
  await Bun.write(outputPath, `${lines.join("\n")}\n`);
}

/**
 * Generate CSV content as string (for testing or alternative output)
 */
export function generateCsvContent(fills: EnrichedFill[]): string {
  const lines: string[] = [];

  // Header
  lines.push(CSV_HEADERS.join(","));

  // Data rows
  for (const fill of fills) {
    lines.push(fillToCsvRow(fill));
  }

  return lines.join("\n");
}
