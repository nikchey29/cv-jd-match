import { describe, expect, it } from "vitest";
import { applyGroundingCheck, containsQuote, findUnsupportedTerms, normalizeText } from "../lib/grounding";
import { parseLlmOutput, type LlmOutput } from "../lib/schema";
import { CV, GOOD_RAW, HALLUCINATED_RAW, JD } from "./fixtures/llm";

function parsed(raw: string): LlmOutput {
  const result = parseLlmOutput(raw);
  if (!result.ok) throw new Error(`fixture did not parse: ${result.reason}`);
  return result.data;
}

describe("normalizeText", () => {
  it("lower-cases and collapses whitespace", () => {
    expect(normalizeText("  Built\tETL\n\n pipelines  ")).toBe("built etl pipelines");
  });
});

describe("containsQuote", () => {
  it("finds an exact quote", () => {
    expect(containsQuote(CV, "Mentored two junior analysts.")).toBe(true);
  });

  it("ignores case differences", () => {
    expect(containsQuote(CV, "MENTORED TWO JUNIOR ANALYSTS")).toBe(true);
  });

  it("ignores whitespace differences, including newlines and repeated spaces", () => {
    // The CV has three spaces between "with" and "Docker".
    expect(containsQuote(CV, "Deployed models with Docker on AWS")).toBe(true);
    expect(containsQuote("line one\nline two", "one line two")).toBe(true);
  });

  it("rejects a paraphrase", () => {
    expect(containsQuote(CV, "Built ETL pipelines using Python at Acme")).toBe(false);
  });

  it("rejects an empty or whitespace-only quote", () => {
    expect(containsQuote(CV, "")).toBe(false);
    expect(containsQuote(CV, "   \n ")).toBe(false);
  });
});

describe("findUnsupportedTerms", () => {
  it("accepts a rewrite that only reuses CV facts", () => {
    expect(findUnsupportedTerms("Mentored two junior analysts in Python and SQL.", CV, JD)).toEqual([]);
  });

  it("flags a JD skill that is not in the CV", () => {
    expect(findUnsupportedTerms("Deployed models with Docker and Kubernetes on AWS.", CV, JD)).toEqual([
      "kubernetes",
    ]);
  });

  it("flags a number that is not in the CV", () => {
    expect(findUnsupportedTerms("Built ETL pipelines processing 5 million rows per day.", CV, JD)).toEqual(["5"]);
  });

  it("treats singular and plural as the same word", () => {
    expect(findUnsupportedTerms("Built an ETL pipeline in Python.", CV, JD)).toEqual([]);
  });
});

describe("applyGroundingCheck", () => {
  it("keeps every item when all quotes are in the CV", () => {
    const result = applyGroundingCheck(parsed(GOOD_RAW), CV, JD);
    expect(result.ungroundedCount).toBe(0);
    expect(result.unsupportedRewriteCount).toBe(0);
    expect(result.requirements).toHaveLength(4);
    expect(result.rewrites).toHaveLength(1);
    expect(result.statusesForScore).toEqual(["met", "met", "partly_met", "not_met"]);
  });

  it("sets evidence to null for not-met requirements", () => {
    const result = applyGroundingCheck(parsed(GOOD_RAW), CV, JD);
    expect(result.requirements.find((r) => r.requirement === "Kubernetes")?.evidence).toBeNull();
  });

  it("drops requirements and rewrites whose quotes are not in the CV and counts them", () => {
    const result = applyGroundingCheck(parsed(HALLUCINATED_RAW), CV, JD);
    expect(result.ungroundedCount).toBe(2); // invented Kubernetes quote + invented rewrite source
    expect(result.requirements.map((r) => r.requirement)).toEqual(["Python"]);
    expect(result.rewrites).toEqual([]);
  });

  it("scores a dropped requirement as not met so hallucinations cannot raise the score", () => {
    const result = applyGroundingCheck(parsed(HALLUCINATED_RAW), CV, JD);
    expect(result.statusesForScore).toEqual(["met", "not_met"]);
  });

  it("treats a met requirement with empty evidence as ungrounded", () => {
    const output: LlmOutput = {
      requirements: [{ requirement: "Python", status: "met", evidence: "" }],
      gaps: [],
      rewrites: [],
    };
    const result = applyGroundingCheck(output, CV, JD);
    expect(result.ungroundedCount).toBe(1);
    expect(result.requirements).toEqual([]);
  });

  it("drops a rewrite that adds facts, without counting it as ungrounded", () => {
    const output: LlmOutput = {
      requirements: [{ requirement: "Docker", status: "met", evidence: "Docker on AWS" }],
      gaps: [],
      rewrites: [
        { original: "Deployed models with Docker on AWS.", rewritten: "Deployed models with Docker and Kubernetes on AWS." },
      ],
    };
    const result = applyGroundingCheck(output, CV, JD);
    expect(result.rewrites).toEqual([]);
    expect(result.unsupportedRewriteCount).toBe(1);
    expect(result.ungroundedCount).toBe(0);
  });
});
