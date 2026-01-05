/**
 * File Sink Service - Reasoning Log Persistence
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4
 * - Save reasoning logs to LOG_DIR/llm/
 * - Filename: llm-reflection-<exchange>-<symbol>-<utc-iso>-<proposal-id>.json
 * - Calculate SHA256 for integrity verification
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

import { ResultAsync } from "neverthrow";

import type { FileSinkResult, ReasoningLogContent } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type FileSinkError =
  | { type: "DIRECTORY_CREATE_FAILED"; message: string }
  | { type: "FILE_WRITE_FAILED"; message: string };

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate filename for reasoning log
 *
 * Requirements: 13.2
 * Format: llm-reflection-<exchange>-<symbol>-<utc-iso>-<proposal-id>.json
 */
export function generateLogFilename(exchange: string, symbol: string, timestamp: Date, proposalId: string): string {
  const isoDate = timestamp.toISOString().replace(/[:.]/g, "-");
  const sanitizedSymbol = symbol.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
  const sanitizedExchange = exchange.toLowerCase();

  return `llm-reflection-${sanitizedExchange}-${sanitizedSymbol}-${isoDate}-${proposalId}.json`;
}

/**
 * Calculate SHA256 hash of content
 */
export function calculateSha256(content: string): string {
  return crypto.createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Create log content with integrity hash
 */
export function createLogContent(logData: Omit<ReasoningLogContent, "integrity">): ReasoningLogContent {
  // Create content without integrity first
  const contentWithoutHash = JSON.stringify(logData, null, 2);
  const sha256 = calculateSha256(contentWithoutHash);

  return {
    ...logData,
    integrity: { sha256 },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// File Sink Service
// ─────────────────────────────────────────────────────────────────────────────

export interface FileSinkOptions {
  logDir: string;
}

/**
 * Save reasoning log to file
 *
 * Requirements: 13.1, 13.4
 */
export function saveReasoningLog(
  options: FileSinkOptions,
  exchange: string,
  symbol: string,
  proposalId: string,
  timestamp: Date,
  logData: Omit<ReasoningLogContent, "integrity">,
): ResultAsync<FileSinkResult, FileSinkError> {
  const llmDir = path.join(options.logDir, "llm");
  const filename = generateLogFilename(exchange, symbol, timestamp, proposalId);
  const filePath = path.join(llmDir, filename);

  // Create log content with integrity hash
  const content = createLogContent(logData);
  const jsonContent = JSON.stringify(content, null, 2);

  return ResultAsync.fromPromise(fs.mkdir(llmDir, { recursive: true }), e => ({
    type: "DIRECTORY_CREATE_FAILED" as const,
    message: e instanceof Error ? e.message : "Unknown error",
  })).andThen(() =>
    ResultAsync.fromPromise(fs.writeFile(filePath, jsonContent, "utf-8"), e => ({
      type: "FILE_WRITE_FAILED" as const,
      message: e instanceof Error ? e.message : "Unknown error",
    })).map(() => ({
      logPath: filePath,
      sha256: content.integrity.sha256,
    })),
  );
}

/**
 * Verify integrity of a reasoning log file
 */
export function verifyLogIntegrity(filePath: string): ResultAsync<boolean, FileSinkError> {
  return ResultAsync.fromPromise(fs.readFile(filePath, "utf-8"), e => ({
    type: "FILE_WRITE_FAILED" as const,
    message: e instanceof Error ? e.message : "Unknown error",
  })).map(content => {
    const parsed = JSON.parse(content) as ReasoningLogContent;
    const storedHash = parsed.integrity.sha256;

    // Recalculate hash without integrity field
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { integrity, ...withoutIntegrity } = parsed;
    const contentWithoutHash = JSON.stringify(withoutIntegrity, null, 2);
    const calculatedHash = calculateSha256(contentWithoutHash);

    return storedHash === calculatedHash;
  });
}
