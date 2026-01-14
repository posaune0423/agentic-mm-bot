/**
 * Migrate LLM Proposals to New Format (v2)
 *
 * Converts all llm_proposal rows from old format to new format:
 *
 * OLD FORMAT:
 * - proposalJson: [{ param, fromValue, toValue }]  (array)
 * - rollbackJson: ["string condition", ...]         (string array)
 *
 * NEW FORMAT:
 * - proposalJson: { paramName: value }              (object with param keys)
 * - rollbackJson: { markout10sP50BelowBps?, pauseCountAbove?, maxDurationMs? }  (structured object)
 *
 * Usage:
 *   bun run scripts/migrate-llm-proposals-v2.ts
 *   bun run scripts/migrate-llm-proposals-v2.ts --dry-run  # Preview only, no DB writes
 *
 * Environment variables:
 *   DATABASE_URL=<postgres connection string>
 */

import { config } from "dotenv";
import { resolve } from "path";

// Load .env from project root
config({ path: resolve(process.cwd(), ".env") });

import { eq } from "drizzle-orm";
import { getDb, llmProposal, type LlmProposal } from "@agentic-mm-bot/db";

// ============================================================================
// Types
// ============================================================================

/** Old format: array of changes */
interface OldParamChange {
  param: string;
  fromValue: string;
  toValue: string;
}

/** New format: object with param keys */
type NewChanges = Record<string, string | number>;

/** New format: structured rollback conditions */
interface NewRollbackConditions {
  markout10sP50BelowBps?: number;
  pauseCountAbove?: number;
  maxDurationMs?: number;
}

// ============================================================================
// Format Detection
// ============================================================================

function isOldChangesFormat(proposalJson: unknown): proposalJson is OldParamChange[] {
  if (!Array.isArray(proposalJson)) return false;
  if (proposalJson.length === 0) return true; // Empty array is old format
  const first = proposalJson[0];
  return typeof first === "object" && first !== null && "param" in first && "toValue" in first;
}

function isOldRollbackFormat(rollbackJson: unknown): rollbackJson is string[] {
  if (!Array.isArray(rollbackJson)) return false;
  if (rollbackJson.length === 0) return true; // Empty array is old format
  return typeof rollbackJson[0] === "string";
}

function isNewFormat(proposalJson: unknown, rollbackJson: unknown): boolean {
  // New format: proposalJson is a non-array object, rollbackJson is a non-array object
  const proposalIsObject = typeof proposalJson === "object" && proposalJson !== null && !Array.isArray(proposalJson);
  const rollbackIsObject = typeof rollbackJson === "object" && rollbackJson !== null && !Array.isArray(rollbackJson);
  return proposalIsObject && rollbackIsObject;
}

// ============================================================================
// Conversion
// ============================================================================

function convertChanges(oldChanges: OldParamChange[]): NewChanges {
  const newChanges: NewChanges = {};
  for (const change of oldChanges) {
    // Use toValue as the new value; handle number conversion for specific params
    const value = change.toValue;
    const numParams = ["refreshIntervalMs", "staleCancelMs", "pauseLiqCount10s"];
    if (numParams.includes(change.param)) {
      const parsed = parseInt(value, 10);
      if (Number.isNaN(parsed)) {
        throw new Error(`Invalid numeric value for param "${change.param}": "${value}"`);
      }
      newChanges[change.param] = parsed;
    } else {
      newChanges[change.param] = value;
    }
  }
  return newChanges;
}

function convertRollbackConditions(oldRollback: string[]): NewRollbackConditions {
  const newRollback: NewRollbackConditions = {};

  // Parse string conditions and try to extract numeric values
  // This is best-effort; if we can't parse, we'll set a safe default
  for (const condition of oldRollback) {
    const lower = condition.toLowerCase();

    // Try to extract markout threshold
    const markoutMatch = lower.match(/markout.*?(-?\d+(?:\.\d+)?)/);
    if (markoutMatch && !newRollback.markout10sP50BelowBps) {
      newRollback.markout10sP50BelowBps = parseFloat(markoutMatch[1]);
    }

    // Try to extract pause count threshold
    const pauseMatch = lower.match(/pause.*?(\d+)/);
    if (pauseMatch && !newRollback.pauseCountAbove) {
      newRollback.pauseCountAbove = parseInt(pauseMatch[1], 10);
    }

    // Try to extract duration (hours/minutes/ms)
    const hourMatch = lower.match(/(\d+)\s*hour/);
    if (hourMatch && !newRollback.maxDurationMs) {
      newRollback.maxDurationMs = parseInt(hourMatch[1], 10) * 3600_000;
    }
  }

  // If no conditions could be parsed, set a safe default (1 hour auto-rollback)
  if (!newRollback.markout10sP50BelowBps && !newRollback.pauseCountAbove && !newRollback.maxDurationMs) {
    newRollback.maxDurationMs = 3600_000; // 1 hour
  }

  return newRollback;
}

// ============================================================================
// CLI
// ============================================================================

interface Opts {
  dryRun: boolean;
  help: boolean;
}

function usage(): string {
  return `
Migrate LLM Proposals to New Format (v2)

Usage:
  bun run scripts/migrate-llm-proposals-v2.ts [options]

Options:
  --dry-run     Preview changes without writing to database
  --help, -h    Show this help message

Environment variables:
  DATABASE_URL  PostgreSQL connection string

Example:
  DATABASE_URL=postgres://... bun run scripts/migrate-llm-proposals-v2.ts --dry-run
`.trim();
}

function parseArgs(argv: string[]): Opts {
  const opts: Opts = {
    dryRun: false,
    help: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") opts.help = true;
    if (arg === "--dry-run") opts.dryRun = true;
  }

  return opts;
}

function nowIso(): string {
  return new Date().toISOString();
}

function log(msg: string, data?: Record<string, unknown>): void {
  if (data) {
    console.log(`[${nowIso()}] ${msg}`, JSON.stringify(data, null, 2));
  } else {
    console.log(`[${nowIso()}] ${msg}`);
  }
}

function logError(msg: string, error?: unknown): void {
  console.error(`[${nowIso()}] ERROR: ${msg}`, error instanceof Error ? error.message : error);
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    console.log(usage());
    process.exit(0);
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    logError("DATABASE_URL environment variable is required");
    process.exit(1);
  }

  log(`Starting migration (dry-run: ${args.dryRun})`);

  const db = getDb(databaseUrl);

  // Fetch all proposals
  log("Fetching all llm_proposal rows...");
  const allProposals = await db.select().from(llmProposal);
  log(`Found ${allProposals.length} proposal(s)`);

  let convertedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const proposal of allProposals) {
    const proposalId = proposal.id;

    try {
      // Check if already in new format
      if (isNewFormat(proposal.proposalJson, proposal.rollbackJson)) {
        skippedCount++;
        continue;
      }

      // Determine what needs conversion
      let newProposalJson: NewChanges | null = null;
      let newRollbackJson: NewRollbackConditions | null = null;

      if (isOldChangesFormat(proposal.proposalJson)) {
        newProposalJson = convertChanges(proposal.proposalJson);
      }

      if (isOldRollbackFormat(proposal.rollbackJson)) {
        newRollbackJson = convertRollbackConditions(proposal.rollbackJson);
      }

      // If nothing to convert, skip
      if (!newProposalJson && !newRollbackJson) {
        skippedCount++;
        continue;
      }

      // Build update payload
      const updatePayload: Partial<LlmProposal> = {};
      if (newProposalJson) {
        updatePayload.proposalJson = newProposalJson;
      }
      if (newRollbackJson) {
        updatePayload.rollbackJson = newRollbackJson;
      }

      log(`Converting proposal ${proposalId}`, {
        status: proposal.status,
        oldProposalJsonType: Array.isArray(proposal.proposalJson) ? "array" : "object",
        oldRollbackJsonType: Array.isArray(proposal.rollbackJson) ? "array" : "object",
        newProposalJson: newProposalJson ?? "(unchanged)",
        newRollbackJson: newRollbackJson ?? "(unchanged)",
      });

      if (!args.dryRun) {
        await db.update(llmProposal).set(updatePayload).where(eq(llmProposal.id, proposalId));
      }

      convertedCount++;
    } catch (error) {
      logError(`Failed to convert proposal ${proposalId}`, error);
      errorCount++;
    }
  }

  // Summary
  log("Migration complete", {
    total: allProposals.length,
    converted: convertedCount,
    skipped: skippedCount,
    errors: errorCount,
    dryRun: args.dryRun,
  });

  if (args.dryRun && convertedCount > 0) {
    log("Dry run mode: no changes were written to the database.");
    log("Run without --dry-run to apply changes.");
  }

  await db.$client.end();
  process.exit(errorCount > 0 ? 1 : 0);
}

// Run
main().catch(error => {
  logError("Unexpected error", error);
  process.exit(1);
});
