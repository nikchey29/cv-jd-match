import type { LlmOutput, LlmRewrite, MatchedRequirement, RequirementStatus } from "./schema";

/**
 * Normalise text for quote matching: lower-case, and collapse every run of
 * whitespace (spaces, tabs, newlines) into a single space.
 */
export function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/** True when `quote` appears in `text`, ignoring case and whitespace differences. */
export function containsQuote(text: string, quote: string): boolean {
  const needle = normalizeText(quote);
  if (needle.length === 0) return false;
  return normalizeText(text).includes(needle);
}

// Common words that may appear in a job description and in a rewrite
// without adding a new fact about the candidate.
const STOPWORDS = new Set(
  (
    "the and for with you your our are was were will this that these those from have has had " +
    "who can all any into onto using use used work worked working team teams role roles " +
    "experience experienced skills skill knowledge ability strong good great excellent " +
    "including include includes such also other more than per across within about over " +
    "new well able help helped make made build built across based their they them its " +
    "not but out own via etc years year plus must should would could may like what when where"
  ).split(" "),
);

function tokens(text: string): string[] {
  return normalizeText(text).match(/[a-z0-9+#]+/g) ?? [];
}

function hasToken(set: Set<string>, token: string): boolean {
  // Light plural handling so "pipeline" and "pipelines" count as the same word.
  return set.has(token) || set.has(`${token}s`) || (token.endsWith("s") && set.has(token.slice(0, -1)));
}

/**
 * Words and numbers in a rewrite that look like new facts: any number that is
 * not in the CV, and any job-description word (3+ letters, not a stopword)
 * that is not in the CV. An empty list means the rewrite is supported.
 */
export function findUnsupportedTerms(rewritten: string, cv: string, jd: string): string[] {
  const cvTokens = new Set(tokens(cv));
  const jdTokens = new Set(tokens(jd));
  const unsupported = new Set<string>();

  const cvNormalized = normalizeText(cv);
  for (const number of rewritten.match(/\d+(?:[.,]\d+)*/g) ?? []) {
    if (!cvNormalized.includes(number)) unsupported.add(number);
  }

  for (const token of tokens(rewritten)) {
    if (/^\d/.test(token) || token.length < 3 || STOPWORDS.has(token)) continue;
    if (hasToken(jdTokens, token) && !hasToken(cvTokens, token)) unsupported.add(token);
  }
  return [...unsupported];
}

export interface GroundedResult {
  /** Requirements whose evidence was verified (or which are "not_met"). */
  requirements: MatchedRequirement[];
  gaps: string[];
  /** Rewrites whose original bullet is in the CV and which add no new facts. */
  rewrites: LlmRewrite[];
  /** Statuses used for scoring. Dropped requirements count as "not_met". */
  statusesForScore: RequirementStatus[];
  /** Evidence or rewrite quotes that were not found in the CV. */
  ungroundedCount: number;
  /** Rewrites dropped because they introduced numbers or JD terms not in the CV. */
  unsupportedRewriteCount: number;
}

/**
 * The grounding check. Every quote the model gives must really be in the CV.
 *
 * - A "met" or "partly_met" requirement whose evidence is not in the CV is
 *   dropped and counted as ungrounded. It still counts as "not_met" in the
 *   score, so an invented quote can never raise the score.
 * - A rewrite whose original bullet is not in the CV is dropped and counted
 *   as ungrounded.
 * - A rewrite that adds a number or JD term the CV does not contain is
 *   dropped and counted as unsupported.
 */
export function applyGroundingCheck(output: LlmOutput, cv: string, jd: string): GroundedResult {
  const requirements: MatchedRequirement[] = [];
  const statusesForScore: RequirementStatus[] = [];
  let ungroundedCount = 0;

  for (const item of output.requirements) {
    if (item.status === "not_met") {
      requirements.push({ requirement: item.requirement, status: "not_met", evidence: null });
      statusesForScore.push("not_met");
    } else if (containsQuote(cv, item.evidence)) {
      requirements.push({ requirement: item.requirement, status: item.status, evidence: item.evidence.trim() });
      statusesForScore.push(item.status);
    } else {
      ungroundedCount += 1;
      statusesForScore.push("not_met");
    }
  }

  const rewrites: LlmRewrite[] = [];
  let unsupportedRewriteCount = 0;
  for (const rewrite of output.rewrites) {
    if (!containsQuote(cv, rewrite.original)) {
      ungroundedCount += 1;
    } else if (findUnsupportedTerms(rewrite.rewritten, cv, jd).length > 0) {
      unsupportedRewriteCount += 1;
    } else {
      rewrites.push({ original: rewrite.original.trim(), rewritten: rewrite.rewritten.trim() });
    }
  }

  return {
    requirements,
    gaps: output.gaps,
    rewrites,
    statusesForScore,
    ungroundedCount,
    unsupportedRewriteCount,
  };
}
