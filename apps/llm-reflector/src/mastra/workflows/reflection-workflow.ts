/**
 * Reflection Workflow
 *
 * Requirements: 10.1, 10.2, 10.3
 * - Orchestrates the full reflection cycle
 * - FetchInput → BuildPrompt → Agent → Gate → File → DB
 */

import { v4 as uuidv4 } from "uuid";
import { ResultAsync, errAsync } from "neverthrow";
import { openai } from "@ai-sdk/openai";
import { generateText, Output } from "ai";

import { logger } from "@agentic-mm-bot/utils";
import type {
  MetricsRepository,
  ProposalRepository,
  HourlyAggregation,
  CurrentParamsSummary,
} from "@agentic-mm-bot/repositories";

import { ProposalOutputSchema, type ProposalOutput } from "../../types/schemas";
import type { FileSinkPort } from "../../ports/file-sink-port";
import { validateProposal, type ParamGateError } from "../../services/param-gate";
import { REFLECTOR_INSTRUCTIONS } from "../agents/reflector-agent";

export type WorkflowError =
  | { type: "FETCH_INPUT_FAILED"; message: string }
  | { type: "AGENT_FAILED"; message: string }
  | { type: "GATE_REJECTED"; error: ParamGateError }
  | { type: "FILE_WRITE_FAILED"; message: string }
  | { type: "DB_INSERT_FAILED"; message: string }
  | { type: "ALREADY_EXISTS"; message: string };

export interface WorkflowDeps {
  metricsRepo: MetricsRepository;
  proposalRepo: ProposalRepository;
  fileSink: FileSinkPort;
  model: string;
  logDir: string;
}

export interface WorkflowResult {
  proposalId: string;
  logPath: string;
  sha256: string;
}

/**
 * Input data for the reflection workflow
 */
interface ReflectionInput {
  exchange: string;
  symbol: string;
  windowStart: Date;
  windowEnd: Date;
  aggregation: HourlyAggregation;
  currentParams: CurrentParamsSummary;
}

/**
 * Build the prompt for the LLM agent
 */
function buildPrompt(input: ReflectionInput): string {
  const worstFillsSummary = input.aggregation.worstFills
    .map(
      (f, i) => `${i + 1}. ${f.side} ${f.fillSz} @ ${f.fillPx}, markout: ${f.markout10sBps?.toFixed(2) ?? "N/A"} bps`,
    )
    .join("\n");

  return `## Performance Summary (Window: ${input.windowStart.toISOString()} - ${input.windowEnd.toISOString()})

### Trading Activity
- Fills: ${input.aggregation.fillsCount}
- Cancels: ${input.aggregation.cancelCount}
- PAUSE events: ${input.aggregation.pauseCount}

### Markout Distribution (10s, bps)
- P10: ${input.aggregation.markout10sP10?.toFixed(2) ?? "N/A"}
- P50 (median): ${input.aggregation.markout10sP50?.toFixed(2) ?? "N/A"}
- P90: ${input.aggregation.markout10sP90?.toFixed(2) ?? "N/A"}

### Worst Fills (by 10s markout)
${worstFillsSummary || "No fills in this period"}

### Current Parameters
- baseHalfSpreadBps: ${input.currentParams.baseHalfSpreadBps}
- volSpreadGain: ${input.currentParams.volSpreadGain}
- toxSpreadGain: ${input.currentParams.toxSpreadGain}
- quoteSizeUsd: ${input.currentParams.quoteSizeUsd}
- refreshIntervalMs: ${input.currentParams.refreshIntervalMs}
- staleCancelMs: ${input.currentParams.staleCancelMs}
- maxInventory: ${input.currentParams.maxInventory}
- inventorySkewGain: ${input.currentParams.inventorySkewGain}
- pauseMarkIndexBps: ${input.currentParams.pauseMarkIndexBps}
- pauseLiqCount10s: ${input.currentParams.pauseLiqCount10s}

Based on this data, suggest parameter changes to improve performance. Remember:
1. Maximum 2 parameter changes
2. Each change must be within ±10% of current value
3. Include rollback conditions
4. Explain your reasoning`;
}

function getOpenAiModelName(model: string): string {
  // Accept "openai/gpt-4o" (preferred) and also allow bare "gpt-4o"
  if (!model.includes("/")) return model;
  const [provider, ...rest] = model.split("/");
  if (provider !== "openai" || rest.length === 0) {
    throw new Error(`Unsupported model string: ${model}. Expected "openai/<model>"`);
  }
  return rest.join("/");
}

/**
 * Execute the reflection workflow
 */
export function executeReflectionWorkflow(
  exchange: string,
  symbol: string,
  windowStart: Date,
  windowEnd: Date,
  deps: WorkflowDeps,
): ResultAsync<WorkflowResult, WorkflowError> {
  // Step 1: Fetch input data
  return (
    fetchInput(exchange, symbol, windowStart, windowEnd, deps.metricsRepo)
      // Step 2: Generate proposal with LLM
      .andThen(input => generateProposal(input, deps.model))
      // Step 3: Validate with ParamGate and persist
      .andThen(({ input, proposal }) => validateAndPersist(input, proposal, deps))
  );
}

/**
 * Fetch all input data from repositories
 */
function fetchInput(
  exchange: string,
  symbol: string,
  windowStart: Date,
  windowEnd: Date,
  repo: MetricsRepository,
): ResultAsync<ReflectionInput, WorkflowError> {
  return ResultAsync.combine([
    repo.getHourlyAggregation(exchange, symbol, windowStart, windowEnd),
    repo.getCurrentParams(exchange, symbol),
  ])
    .mapErr((e): WorkflowError => ({ type: "FETCH_INPUT_FAILED", message: e.message }))
    .map(([aggregation, currentParams]) => ({
      exchange,
      symbol,
      windowStart,
      windowEnd,
      aggregation,
      currentParams,
    }));
}

/**
 * Generate proposal using LLM agent
 */
function generateProposal(
  input: ReflectionInput,
  model: string,
): ResultAsync<{ input: ReflectionInput; proposal: ProposalOutput }, WorkflowError> {
  const prompt = buildPrompt(input);

  type GenerateTextOutputResult<T> = { output: T };

  return ResultAsync.fromPromise(
    generateText({
      model: openai(getOpenAiModelName(model)),
      output: Output.object({ schema: ProposalOutputSchema }),
      system: REFLECTOR_INSTRUCTIONS,
      prompt,
    }) as Promise<GenerateTextOutputResult<ProposalOutput>>,
    (error): WorkflowError => ({
      type: "AGENT_FAILED",
      message: error instanceof Error ? error.message : "Unknown agent error",
    }),
  ).map(result => ({
    input,
    proposal: result.output,
  }));
}

/**
 * Validate proposal and persist to file + DB
 */
function validateAndPersist(
  input: ReflectionInput,
  proposal: ProposalOutput,
  deps: WorkflowDeps,
): ResultAsync<WorkflowResult, WorkflowError> {
  // Validate with ParamGate
  const validationResult = validateProposal(proposal, input.currentParams);

  if (validationResult.isErr()) {
    logger.warn("Proposal rejected by ParamGate", { error: validationResult.error });
    return errAsync({
      type: "GATE_REJECTED",
      error: validationResult.error,
    });
  }

  const proposalId = uuidv4();

  // Build reasoning log content
  const logContent = {
    proposalId,
    timestamp: new Date().toISOString(),
    exchange: input.exchange,
    symbol: input.symbol,
    inputSummary: {
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString(),
      fillsCount: input.aggregation.fillsCount,
      cancelCount: input.aggregation.cancelCount,
      pauseCount: input.aggregation.pauseCount,
      markout10sP50: input.aggregation.markout10sP50,
      worstFillsCount: input.aggregation.worstFills.length,
    },
    currentParams: input.currentParams,
    proposal,
  };

  // Write to file first (requirement: file must succeed before DB)
  return deps.fileSink
    .writeJsonLog(deps.logDir, input.exchange, input.symbol, proposalId, logContent)
    .mapErr((e): WorkflowError => ({ type: "FILE_WRITE_FAILED", message: e.message }))
    .andThen(({ path, sha256 }) =>
      // Only insert to DB if file write succeeded
      deps.proposalRepo
        .saveProposal({
          exchange: input.exchange,
          symbol: input.symbol,
          ts: new Date(),
          inputWindowStart: input.windowStart,
          inputWindowEnd: input.windowEnd,
          currentParamsSetId: input.currentParams.paramsSetId,
          proposalJson: proposal.changes,
          rollbackJson: proposal.rollbackConditions,
          reasoningLogPath: path,
          reasoningLogSha256: sha256,
          status: "pending",
        })
        .mapErr((e): WorkflowError => ({ type: "DB_INSERT_FAILED", message: e.message }))
        .map(() => ({
          proposalId,
          logPath: path,
          sha256,
        })),
    );
}
