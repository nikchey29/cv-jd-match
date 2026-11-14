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

/**
 * "skill": something a CV can show (a skill, tool, experience, education,
 * certification, language). "trait": a personal quality such as "self-starter"
 * that a quote from a CV cannot prove.
 */
export const REQUIREMENT_KINDS = ["skill", "trait"] as const;
export type RequirementKind = (typeof REQUIREMENT_KINDS)[number];

export const LlmRequirementSchema = z.strictObject({
  requirement: z.string().min(1),
  kind: z.enum(REQUIREMENT_KINDS),
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
// The repair pass: one follow-up call for quotes that were not found in the CV.
// ---------------------------------------------------------------------------

/** What the model answers for an item whose quote could not be found. */
export const REPAIR_NONE = "none";

export const RepairOutputSchema = z.strictObject({
  answers: z.array(
    z.strictObject({
      /** The item number we sent. */
      id: z.number().int(),
      /** A corrected verbatim quote from the CV, or "none". */
      quote: z.string(),
    }),
  ),
});
export type RepairOutput = z.infer<typeof RepairOutputSchema>;

export const repairOutputJsonSchema = z.toJSONSchema(RepairOutputSchema, { target: "draft-7" }) as Record<
  string,
  unknown
>;

/** Parse the repair answer, or return null when it is not valid. */
export function parseRepairOutput(raw: string): RepairOutput | null {
  try {
    const result = RepairOutputSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Response bodies returned to the browser
// ---------------------------------------------------------------------------

/**
 * Status shown to the user. "unverified" means the model said met or partly
 * met, but its quote was still not found in the CV after the repair pass.
 */
export type DisplayStatus = RequirementStatus | "unverified";

export interface MatchedRequirement {
  requirement: string;
  status: DisplayStatus;
  /** Verified quote from the CV, or null when not met or unverified. */
  evidence: string | null;
}

export interface MatchResponse {
  /** Row id for feedback, or null if the result could not be saved. */
  id: string | null;
  /** 0..100, or null when no requirement could be scored (all unverified). */
  score: number | null;
  /** Requirements in the score's denominator: met, partly met and not met. */
  scoredCount: number;
  /** Skill requirements, checked against the CV. */
  requirements: MatchedRequirement[];
  /** Trait requirements ("self-starter"): not checkable from a CV, not scored. */
  traits: string[];
  gaps: string[];
  rewrites: LlmRewrite[];
  /** Every requirement the model found in the JD: skills (incl. unverified) and traits. */
  requirementCount: number;
  /**
   * Quotes still not found in the CV after the repair pass: unverified
   * requirements plus rewrites hidden because their original is not in the CV.
   */
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
