/**
 * FileSinkPort Unit Tests
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4
 * - File naming convention: llm-reflection-<exchange>-<symbol>-<utc-iso>-<proposal-id>.json
 * - SHA256 integrity hash calculation
 * - Failure behavior
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { rm, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";

import { createFileSinkPort } from "../src/ports/file-sink-port";

describe("createFileSinkPort", () => {
  let testDir: string;

  beforeEach(() => {
    // Create a unique temp directory for each test
    testDir = join(
      tmpdir(),
      `llm-reflector-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
  });

  afterEach(async () => {
    // Clean up test directory
    try {
      await rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("writeJsonLog", () => {
    it("should write file with correct naming convention", async () => {
      const fileSink = createFileSinkPort();
      const content = {
        proposalId: "test-proposal-123",
        data: { key: "value" },
      };

      const result = await fileSink.writeJsonLog(
        testDir,
        "extended",
        "BTC-USD",
        "proposal-abc123",
        content,
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Check filename pattern
        expect(result.value.path).toMatch(
          /llm-reflection-extended-BTC-USD-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-proposal-abc123\.json$/,
        );

        // Verify file exists
        const fileStat = await stat(result.value.path);
        expect(fileStat.isFile()).toBe(true);
      }
    });

    it("should sanitize symbol name in filename", async () => {
      const fileSink = createFileSinkPort();
      const content = { test: "data" };

      const result = await fileSink.writeJsonLog(
        testDir,
        "extended",
        "ETH/USDT:PERP", // Contains special characters
        "proposal-xyz",
        content,
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Get just the filename from the path
        const filename = result.value.path.split("/").pop() ?? "";

        // Special characters should be replaced with hyphens
        expect(filename).toContain("ETH-USDT-PERP");
        expect(filename).not.toContain("/");
        expect(filename).not.toContain(":");
      }
    });

    it("should calculate correct SHA256 hash", async () => {
      const fileSink = createFileSinkPort();
      const content = {
        proposalId: "hash-test",
        data: { value: 123 },
      };

      const result = await fileSink.writeJsonLog(
        testDir,
        "extended",
        "BTC-USD",
        "hash-test",
        content,
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Read the file and verify hash
        const fileContent = await readFile(result.value.path, "utf-8");
        const parsed = JSON.parse(fileContent);

        // SHA256 should be calculated without the integrity field
        const contentWithoutIntegrity = { ...parsed };
        delete contentWithoutIntegrity.integrity;
        const expectedHash = createHash("sha256")
          .update(JSON.stringify(contentWithoutIntegrity, null, 2))
          .digest("hex");

        expect(parsed.integrity.sha256).toBe(expectedHash);
        expect(result.value.sha256).toBe(expectedHash);
      }
    });

    it("should include integrity field in the saved file", async () => {
      const fileSink = createFileSinkPort();
      const content = {
        proposalId: "integrity-test",
        changes: [
          { param: "baseHalfSpreadBps", fromValue: "1.5", toValue: "1.6" },
        ],
      };

      const result = await fileSink.writeJsonLog(
        testDir,
        "extended",
        "BTC-USD",
        "integrity-test",
        content,
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const fileContent = await readFile(result.value.path, "utf-8");
        const parsed = JSON.parse(fileContent);

        expect(parsed.integrity).toBeDefined();
        expect(parsed.integrity.sha256).toBeDefined();
        expect(typeof parsed.integrity.sha256).toBe("string");
        expect(parsed.integrity.sha256).toHaveLength(64); // SHA256 hex length
      }
    });

    it("should create llm subdirectory if it does not exist", async () => {
      const fileSink = createFileSinkPort();
      const content = { test: "mkdir" };

      const result = await fileSink.writeJsonLog(
        testDir,
        "extended",
        "BTC-USD",
        "mkdir-test",
        content,
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Verify llm subdirectory was created
        const llmDir = join(testDir, "llm");
        const dirStat = await stat(llmDir);
        expect(dirStat.isDirectory()).toBe(true);
      }
    });

    it("should preserve original content fields", async () => {
      const fileSink = createFileSinkPort();
      const content = {
        proposalId: "preserve-test",
        timestamp: "2025-01-05T12:00:00Z",
        changes: [
          { param: "baseHalfSpreadBps", fromValue: "1.5", toValue: "1.6" },
        ],
        rollbackConditions: ["revert if markout < -10bps"],
        reasoningTrace: ["test reasoning"],
      };

      const result = await fileSink.writeJsonLog(
        testDir,
        "extended",
        "BTC-USD",
        "preserve-test",
        content,
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const fileContent = await readFile(result.value.path, "utf-8");
        const parsed = JSON.parse(fileContent);

        // All original fields should be preserved
        expect(parsed.proposalId).toBe(content.proposalId);
        expect(parsed.timestamp).toBe(content.timestamp);
        expect(parsed.changes).toEqual(content.changes);
        expect(parsed.rollbackConditions).toEqual(content.rollbackConditions);
        expect(parsed.reasoningTrace).toEqual(content.reasoningTrace);
      }
    });

    it("should overwrite existing integrity field from input", async () => {
      const fileSink = createFileSinkPort();
      const content = {
        proposalId: "overwrite-test",
        integrity: { sha256: "fake-hash-should-be-overwritten" },
      };

      const result = await fileSink.writeJsonLog(
        testDir,
        "extended",
        "BTC-USD",
        "overwrite-test",
        content,
      );

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const fileContent = await readFile(result.value.path, "utf-8");
        const parsed = JSON.parse(fileContent);

        // Integrity should NOT be the fake hash
        expect(parsed.integrity.sha256).not.toBe(
          "fake-hash-should-be-overwritten",
        );
        expect(parsed.integrity.sha256).toHaveLength(64);
      }
    });
  });
});
