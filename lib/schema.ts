import { z } from "zod";
import { MAX_INPUT_CHARS, MAX_REWRITES } from "./limits";

export { MAX_INPUT_CHARS, MAX_REWRITES };

// ---------------------------------------------------------------------------
// Request bodies sent by the browser
// ---------------------------------------------------------------------------

const pastedText = (label: string) =>
  z
    .string({ error: `${label} must be text.` })
    .trim()
    .min(1, `${label} is empty.`)
    .max(MAX_INPUT_CHARS, `${label} is longer than ${MAX_INPUT_CHARS.toLocaleString("en-US")} characters.`);

export const MatchRequestSchema = z.object({
  jd: pastedText("Job description"),
  cv: pastedText("CV"),
});
export type MatchRequest = z.infer<typeof MatchRequestSchema>;

export const FeedbackRequestSchema = z.object({
  id: z.uuid({ error: "id must be a UUID." }),
  helpful: z.boolean({ error: "helpful must be true or false." }),
});
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;

// ---------------------------------------------------------------------------
// What the LLM must return. Sent to Groq as a strict JSON schema and
// validated again with zod, because we never trust model output blindly.
// ---------------------------------------------------------------------------

export const REQUIREMENT_STATUSES = ["met", "partly_met", "not_met"] as const;
export type RequirementStatus = (typeof REQUIREMENT_STATUSES)[number];

export const LlmRequirementSchema = z.strictObject({
  requirement: z.string().min(1),
  status: z.enum(REQUIREMENT_STATUSES),
  /** Exact quote from the CV. Empty string when status is "not_met". */
  evidence: z.string(),
});

export const LlmRewriteSchema = z.strictObject({
  /** Exact quote of the existing CV bullet. */
  original: z.string().min(1),
  /** Improved wording that uses only facts from the original CV. */
  rewritten: z.string().min(1),
});

export const LlmOutputSchema = z.strictObject({
  requirements: z.array(LlmRequirementSchema).min(1).max(25),
  gaps: z.array(z.string().min(1)).max(15),
  rewrites: z.array(LlmRewriteSchema).max(MAX_REWRITES),
});
export type LlmOutput = z.infer<typeof LlmOutputSchema>;
export type LlmRequirement = z.infer<typeof LlmRequirementSchema>;
export type LlmRewrite = z.infer<typeof LlmRewriteSchema>;

/** JSON Schema version of LlmOutputSchema, passed to the model. */
export const llmOutputJsonSchema = z.toJSONSchema(LlmOutputSchema, { target: "draft-7" }) as Record<string, unknown>;

export type ParseResult = { ok: true; data: LlmOutput } | { ok: false; reason: "invalid_json" | "schema_mismatch" };

/** Parse raw model text into a validated LlmOutput, or explain why not. */
export function parseLlmOutput(raw: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  const result = LlmOutputSchema.safeParse(json);
  return result.success ? { ok: true, data: result.data } : { ok: false, reason: "schema_mismatch" };
}

// ---------------------------------------------------------------------------
// Response bodies returned to the browser
// ---------------------------------------------------------------------------

export interface MatchedRequirement {
  requirement: string;
  status: RequirementStatus;
  /** Verified quote from the CV, or null when the requirement is not met. */
  evidence: string | null;
}

export interface MatchResponse {
  /** Row id for feedback, or null if the result could not be saved. */
  id: string | null;
  score: number;
  requirements: MatchedRequirement[];
  gaps: string[];
  rewrites: LlmRewrite[];
  /** Total requirements the model found in the JD, including dropped ones. */
  requirementCount: number;
  /** Items dropped because their quote was not found in the CV. */
  ungroundedCount: number;
  /** Rewrites dropped because they added numbers or JD terms not in the CV. */
  unsupportedRewriteCount: number;
  model: string;
  latencyMs: number;
}

export interface StatsResponse {
  totalRuns: number;
  /** 0..1, or null when there are no runs yet. */
  feedbackShare: number | null;
  /** 0..1 of runs with feedback, or null when there is no feedback yet. */
  helpfulShare: number | null;
  /** Mean ungrounded items per run, or null when there are no runs yet. */
  avgUngrounded: number | null;
}

export interface ErrorResponse {
  error: string;
}
