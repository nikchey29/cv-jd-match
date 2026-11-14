import { applyGroundingCheck } from "../../lib/grounding";
import { applyRepairAnswers, findUngroundedQuotes } from "../../lib/repair";
import {
  parseLlmOutput,
  parseRepairOutput,
  type LlmOutput,
  type LlmRewrite,
  type MatchedRequirement,
} from "../../lib/schema";
import { computeScore } from "../../lib/scoring";
import { InvalidLlmOutputError, REPAIR_FORMAT, type CompleteFn } from "./llm";
import { buildMessages, buildRepairMessages, RETRY_INSTRUCTION, SYSTEM_PROMPT } from "./prompt";

/**
 * Groq's free tier allows 8,000 tokens per minute per model, and it rejects a
 * single request above that. We keep the prompt under 6,000 estimated tokens
 * so the answer (usually 1,000-2,000 tokens) still fits.
 */
export const INPUT_TOKEN_BUDGET = 6_000;

/** Rough English average. Real tokenisers vary, so this is an estimate. */
export const CHARS_PER_TOKEN = 4;

export function estimatePromptTokens(jd: string, cv: string): number {
  const chars = SYSTEM_PROMPT.length + jd.length + cv.length;
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

/** The JD and CV together are too long for the free-tier token budget. */
export class InputTooLargeError extends Error {
  constructor(readonly estimatedTokens: number) {
    super(`Estimated ${estimatedTokens} prompt tokens, budget is ${INPUT_TOKEN_BUDGET}`);
    this.name = "InputTooLargeError";
  }
}

/**
 * Do not start the repair pass once this much time has gone by, so slow or
 * rate-limited first calls do not push the request past the function timeout.
 */
export const REPAIR_SKIP_AFTER_MS = 30_000;

export interface RepairSummary {
  /**
   * not_needed: every quote was found. done: the repair call answered.
   * failed: it errored or answered invalid JSON. skipped: no time left.
   */
  status: "not_needed" | "done" | "failed" | "skipped";
  /** Quotes the repair pass replaced with a quote that is in the CV. */
  fixed: number;
  /** Items the model withdrew by answering "none". */
  retracted: number;
  /** Error class name when status is "failed" because the call threw. */
  errorName: string | null;
}

export interface AnalysisResult {
  score: number;
  requirements: MatchedRequirement[];
  gaps: string[];
  rewrites: LlmRewrite[];
  requirementCount: number;
  /** Quotes still not found in the CV after the repair pass. */
  ungroundedCount: number;
  /** Quotes not found in the CV before the repair pass. */
  initialUngroundedCount: number;
  unsupportedRewriteCount: number;
  /** 1 when the first answer was valid, 2 when we had to retry. */
  attempts: 1 | 2;
  repair: RepairSummary;
}

export interface AnalyzeOptions {
  /** Clock in milliseconds; tests replace it. */
  now?: () => number;
}

async function askOnce(complete: CompleteFn, messages: Parameters<CompleteFn>[0]): Promise<LlmOutput | null> {
  let raw: string;
  try {
    raw = await complete(messages);
  } catch (error) {
    if (error instanceof InvalidLlmOutputError) return null;
    throw error;
  }
  const parsed = parseLlmOutput(raw);
  return parsed.ok ? parsed.data : null;
}

/**
 * One follow-up call that lists only the quotes not found in the CV and asks
 * for a corrected verbatim quote or "none". Errors never fail the request:
 * the items simply stay ungrounded. Rate limits are handled inside `complete`.
 */
async function repairQuotes(
  output: LlmOutput,
  cv: string,
  complete: CompleteFn,
): Promise<{ output: LlmOutput; summary: RepairSummary }> {
  const quotes = findUngroundedQuotes(output, cv);
  const summary: RepairSummary = { status: "not_needed", fixed: 0, retracted: 0, errorName: null };
  if (quotes.length === 0) return { output, summary };

  let raw: string;
  try {
    raw = await complete(buildRepairMessages(cv, quotes), REPAIR_FORMAT);
  } catch (error) {
    summary.status = "failed";
    summary.errorName = error instanceof Error ? error.name : "Error";
    return { output, summary };
  }
  const answer = parseRepairOutput(raw);
  if (!answer) {
    summary.status = "failed";
    return { output, summary };
  }
  const outcome = applyRepairAnswers(output, quotes, answer.answers, cv);
  return { output: outcome.output, summary: { ...summary, status: "done", fixed: outcome.fixed, retracted: outcome.retracted } };
}

/**
 * The core pipeline, shared by the API and the eval script:
 * budget check -> LLM (retry once on invalid JSON) -> repair pass for quotes
 * not found in the CV -> grounding check -> score.
 * `complete` is passed in so tests can use a fake LLM.
 */
export async function analyzeMatch(
  jd: string,
  cv: string,
  complete: CompleteFn,
  options: AnalyzeOptions = {},
): Promise<AnalysisResult> {
  const now = options.now ?? (() => performance.now());
  const started = now();
  const estimatedTokens = estimatePromptTokens(jd, cv);
  if (estimatedTokens > INPUT_TOKEN_BUDGET) throw new InputTooLargeError(estimatedTokens);

  const messages = buildMessages(jd, cv);
  let attempts: 1 | 2 = 1;
  let output = await askOnce(complete, messages);
  if (output === null) {
    attempts = 2;
    output = await askOnce(complete, [...messages, { role: "user", content: RETRY_INSTRUCTION }]);
  }
  if (output === null) throw new InvalidLlmOutputError();

  const initialUngroundedCount = findUngroundedQuotes(output, cv).length;
  let repair: RepairSummary;
  if (initialUngroundedCount > 0 && now() - started > REPAIR_SKIP_AFTER_MS) {
    repair = { status: "skipped", fixed: 0, retracted: 0, errorName: null };
  } else {
    ({ output, summary: repair } = await repairQuotes(output, cv, complete));
  }

  const grounded = applyGroundingCheck(output, cv, jd);
  return {
    score: computeScore(grounded.statusesForScore),
    requirements: grounded.requirements,
    gaps: grounded.gaps,
    rewrites: grounded.rewrites,
    requirementCount: output.requirements.length,
    ungroundedCount: grounded.ungroundedCount,
    initialUngroundedCount,
    unsupportedRewriteCount: grounded.unsupportedRewriteCount,
    attempts,
    repair,
  };
}
