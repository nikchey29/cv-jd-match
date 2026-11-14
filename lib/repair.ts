import { containsQuote } from "./grounding";
import { REPAIR_NONE, type LlmOutput, type RepairOutput } from "./schema";

/** A quote from the model's answer that was not found in the CV. */
export interface UngroundedQuote {
  /** 1-based number sent to the model and echoed back in its answer. */
  id: number;
  /** "evidence" of a requirement, or "original" of a rewrite. */
  kind: "evidence" | "original";
  /** Position in output.requirements or output.rewrites. */
  index: number;
  /** What the quote is meant to prove, sent to the model. */
  claim: string;
  quote: string;
}

/** List every met/partly met evidence quote and rewrite original that is not in the CV. */
export function findUngroundedQuotes(output: LlmOutput, cv: string): UngroundedQuote[] {
  const found: UngroundedQuote[] = [];
  output.requirements.forEach((item, index) => {
    // Traits are not judged, so their quotes do not matter.
    if (item.kind === "skill" && item.status !== "not_met" && !containsQuote(cv, item.evidence)) {
      found.push({
        id: found.length + 1,
        kind: "evidence",
        index,
        claim: `The CV shows this job requirement: ${item.requirement}`,
        quote: item.evidence,
      });
    }
  });
  output.rewrites.forEach((rewrite, index) => {
    if (!containsQuote(cv, rewrite.original)) {
      found.push({
        id: found.length + 1,
        kind: "original",
        index,
        claim: `The CV contains the bullet that this text rewrites: ${rewrite.rewritten}`,
        quote: rewrite.original,
      });
    }
  });
  return found;
}

export interface RepairOutcome {
  /** The model's output with corrected quotes applied. */
  output: LlmOutput;
  /** Quotes replaced by a corrected quote that is in the CV. */
  fixed: number;
  /** Items where the model answered "none": the requirement becomes not met, the rewrite is removed. */
  retracted: number;
}

/**
 * Apply the repair answers. A corrected quote is used only if it really is
 * in the CV; anything else leaves the item as it was, so the normal grounding
 * check still catches it. "none" means the model withdraws the claim.
 */
export function applyRepairAnswers(
  output: LlmOutput,
  quotes: UngroundedQuote[],
  answers: RepairOutput["answers"],
  cv: string,
): RepairOutcome {
  const requirements = output.requirements.map((item) => ({ ...item }));
  const rewrites = output.rewrites.map((item) => ({ ...item }));
  const removedRewrites = new Set<number>();
  let fixed = 0;
  let retracted = 0;

  for (const quote of quotes) {
    const answer = answers.find((a) => a.id === quote.id);
    if (!answer) continue;
    const text = answer.quote.trim();
    const isNone = text.toLowerCase() === REPAIR_NONE;

    if (quote.kind === "evidence") {
      const item = requirements[quote.index]!;
      if (isNone) {
        item.status = "not_met";
        item.evidence = "";
        retracted += 1;
      } else if (containsQuote(cv, text)) {
        item.evidence = text;
        fixed += 1;
      }
    } else if (isNone) {
      removedRewrites.add(quote.index);
      retracted += 1;
    } else if (containsQuote(cv, text)) {
      rewrites[quote.index]!.original = text;
      fixed += 1;
    }
  }

  return {
    output: { ...output, requirements, rewrites: rewrites.filter((_, index) => !removedRewrites.has(index)) },
    fixed,
    retracted,
  };
}
