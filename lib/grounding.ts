import type { LlmOutput, LlmRewrite, MatchedRequirement, RequirementStatus } from "./schema";

// Characters that text copied out of a PDF or Word file often contains.
// Written as escapes so the source stays readable.
const INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g; // soft hyphen, zero-width spaces and joiners, BOM
const SINGLE_QUOTES = /[\u2018\u2019\u201A\u201B\u2032\u00B4`]/g; // ‘ ’ ‚ ‛ ′ ´ `
const DOUBLE_QUOTES = /[\u201C\u201D\u201E\u201F\u2033\u00AB\u00BB]/g; // “ ” „ ‟ ″ « »
const DASHES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g; // ‐ ‑ ‒ – — ― − and small/full-width forms
// • ‣ ⁃ ∙ · ▪ ▫ ■ □ ● ○ ◦ ➢ ➤ ✓ ✔, plus the private-use bullets Word's Symbol font exports.
const BULLETS = /[\u2022\u2023\u2043\u2219\u00B7\u25AA\u25AB\u25A0\u25A1\u25CF\u25CB\u25E6\u27A2\u27A4\u2713\u2714\uF0A7\uF0B7\uF076\uF0D8]/g;
// A word split at a line break: "pipe-\nlines" becomes "pipelines".
const LINE_BREAK_HYPHEN = /(\p{L})-[ \t]*\r?\n\s*(\p{L})/gu;

/**
 * Normalise text for quote matching, so a quote the model copied from a CV
 * still matches when the CV was pasted from a PDF:
 *
 * - Unicode NFKC: ligatures such as "ﬁ" become "fi", non-breaking and other
 *   special spaces become plain spaces, "…" becomes "...".
 * - Soft hyphens and zero-width characters are removed.
 * - Curly quotes become straight quotes; every dash becomes "-".
 * - A word split by a hyphen at a line break is joined again.
 * - Bullet characters become spaces.
 * - Every run of whitespace becomes one space, and the text is lower-cased.
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(INVISIBLE, "")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .replace(DASHES, "-")
    .replace(LINE_BREAK_HYPHEN, "$1$2")
    .replace(BULLETS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Punctuation the model may add or leave out at the ends of a quote.
const EDGE_PUNCTUATION = /^[\s"'.,;:!?()-]+|[\s"'.,;:!?()-]+$/g;

/**
 * Hyphens removed, for a second comparison. A PDF can split "data-driven"
 * as "data-\ndriven", which normalisation joins to "datadriven"; the model
 * will quote "data-driven". Dropping hyphens on both sides matches the two.
 */
const withoutHyphens = (normalized: string) => normalized.replace(/-/g, "").replace(/ {2,}/g, " ");

/**
 * True when `quote` appears in `text` after both are normalised (see
 * normalizeText). Punctuation at the very start or end of the quote is ignored.
 */
export function containsQuote(text: string, quote: string): boolean {
  const needle = normalizeText(quote).replace(EDGE_PUNCTUATION, "");
  if (needle.length === 0) return false;
  const haystack = normalizeText(text);
  return haystack.includes(needle) || withoutHyphens(haystack).includes(withoutHyphens(needle));
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
  /** Every skill requirement; ones whose quote is not in the CV are "unverified". */
  requirements: MatchedRequirement[];
  /** Trait requirements, which a CV cannot prove: shown apart, never scored. */
  traits: string[];
  gaps: string[];
  /** Rewrites whose original bullet is in the CV and which add no new facts. */
  rewrites: LlmRewrite[];
  /** Statuses used for scoring. Unverified requirements are left out. */
  statusesForScore: RequirementStatus[];
  /** Evidence or rewrite quotes that were not found in the CV. */
  ungroundedCount: number;
  /** Rewrites dropped because they introduced numbers or JD terms not in the CV. */
  unsupportedRewriteCount: number;
}

/**
 * The grounding check. Every quote the model gives must really be in the CV.
 * It runs after the repair pass, so what it finds is "still ungrounded".
 *
 * - A "met" or "partly_met" requirement whose evidence is not in the CV
 *   becomes "unverified", loses its quote, is counted as ungrounded, and is
 *   left out of the score (numerator and denominator), so an invented quote
 *   can never raise the score.
 * - A "trait" requirement (such as "self-starter") is moved to `traits`
 *   whatever status the model gave it, and is never scored.
 * - A rewrite whose original bullet is not in the CV is dropped and counted
 *   as ungrounded.
 * - A rewrite that adds a number or JD term the CV does not contain is
 *   dropped and counted as unsupported.
 */
export function applyGroundingCheck(output: LlmOutput, cv: string, jd: string): GroundedResult {
  const requirements: MatchedRequirement[] = [];
  const traits: string[] = [];
  const statusesForScore: RequirementStatus[] = [];
  let ungroundedCount = 0;

  for (const item of output.requirements) {
    if (item.kind === "trait") {
      traits.push(item.requirement);
    } else if (item.status === "not_met") {
      requirements.push({ requirement: item.requirement, status: "not_met", evidence: null });
      statusesForScore.push("not_met");
    } else if (containsQuote(cv, item.evidence)) {
      requirements.push({ requirement: item.requirement, status: item.status, evidence: item.evidence.trim() });
      statusesForScore.push(item.status);
    } else {
      requirements.push({ requirement: item.requirement, status: "unverified", evidence: null });
      ungroundedCount += 1;
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
    traits,
    gaps: output.gaps,
    rewrites,
    statusesForScore,
    ungroundedCount,
    unsupportedRewriteCount,
  };
}
