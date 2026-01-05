/**
 * File Sink Port
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4
 * - Write reasoning logs to LOG_DIR/llm/
 * - Calculate sha256 hash for integrity
 * - File naming convention
 */

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { ResultAsync } from "neverthrow";

export type FileSinkError = { type: "MKDIR_FAILED"; message: string } | { type: "WRITE_FAILED"; message: string };

export interface FileSinkPort {
  /**
   * Write JSON content to a file and return the sha256 hash
   */
  writeJsonLog(
    logDir: string,
    exchange: string,
    symbol: string,
    proposalId: string,
    content: unknown,
  ): ResultAsync<{ path: string; sha256: string }, FileSinkError>;
}

/**
 * Generate filename according to convention:
 * llm-reflection-<exchange>-<symbol>-<utc-iso>-<proposal-id>.json
 */
function generateFilename(exchange: string, symbol: string, proposalId: string): string {
  const utcIso = new Date().toISOString().replace(/[:.]/g, "-");
  const safeSymbol = symbol.replace(/[^a-zA-Z0-9-]/g, "-");
  return `llm-reflection-${exchange}-${safeSymbol}-${utcIso}-${proposalId}.json`;
}

/**
 * Calculate sha256 hash of content
 */
function calculateSha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export function createFileSinkPort(): FileSinkPort {
  return {
    writeJsonLog(
      logDir: string,
      exchange: string,
      symbol: string,
      proposalId: string,
      content: unknown,
    ): ResultAsync<{ path: string; sha256: string }, FileSinkError> {
      const llmDir = join(logDir, "llm");
      const filename = generateFilename(exchange, symbol, proposalId);
      const filePath = join(llmDir, filename);

      // Serialize content without integrity field first
      const contentWithoutIntegrity = {
        ...(content as Record<string, unknown>),
      };
      delete contentWithoutIntegrity.integrity;
      const jsonWithoutIntegrity = JSON.stringify(contentWithoutIntegrity, null, 2);
      const sha256 = calculateSha256(jsonWithoutIntegrity);

      // Add integrity field
      const finalContent = {
        ...contentWithoutIntegrity,
        integrity: { sha256 },
      };
      const finalJson = JSON.stringify(finalContent, null, 2);

      return ResultAsync.fromPromise(
        mkdir(llmDir, { recursive: true }),
        (error): FileSinkError => ({
          type: "MKDIR_FAILED",
          message: error instanceof Error ? error.message : "Unknown error",
        }),
      ).andThen(() =>
        ResultAsync.fromPromise(
          writeFile(filePath, finalJson, "utf-8"),
          (error): FileSinkError => ({
            type: "WRITE_FAILED",
            message: error instanceof Error ? error.message : "Unknown error",
          }),
        ).map(() => ({
          path: filePath,
          sha256,
        })),
      );
    },
  };
}
