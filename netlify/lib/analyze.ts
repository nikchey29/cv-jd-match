import { applyGroundingCheck } from "../../lib/grounding";
import { parseLlmOutput, type LlmOutput, type LlmRewrite, type MatchedRequirement } from "../../lib/schema";
import { computeScore } from "../../lib/scoring";
import { InvalidLlmOutputError, type CompleteFn } from "./llm";
import { buildMessages, RETRY_INSTRUCTION, SYSTEM_PROMPT } from "./prompt";

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

export interface AnalysisResult {
  score: number;
  requirements: MatchedRequirement[];
  gaps: string[];
  rewrites: LlmRewrite[];
  requirementCount: number;
  ungroundedCount: number;
  unsupportedRewriteCount: number;
  /** 1 when the first answer was valid, 2 when we had to retry. */
  attempts: 1 | 2;
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
 * The core pipeline, shared by the API and the eval script:
 * budget check -> LLM (retry once on invalid JSON) -> grounding check -> score.
 * `complete` is passed in so tests can use a fake LLM.
 */
export async function analyzeMatch(jd: string, cv: string, complete: CompleteFn): Promise<AnalysisResult> {
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

  const grounded = applyGroundingCheck(output, cv, jd);
  return {
    score: computeScore(grounded.statusesForScore),
    requirements: grounded.requirements,
    gaps: grounded.gaps,
    rewrites: grounded.rewrites,
    requirementCount: output.requirements.length,
    ungroundedCount: grounded.ungroundedCount,
    unsupportedRewriteCount: grounded.unsupportedRewriteCount,
    attempts,
  };
}
