import { describe, expect, it } from "vitest";
import { applyGroundingCheck, containsQuote, findUnsupportedTerms, normalizeText } from "../lib/grounding";
import { parseLlmOutput, type LlmOutput } from "../lib/schema";
import { CV, GOOD_RAW, HALLUCINATED_RAW, JD } from "./fixtures/llm";
import { PDF_CV, PDF_QUOTES } from "./fixtures/pdfText";

function parsed(raw: string): LlmOutput {
  const result = parseLlmOutput(raw);
  if (!result.ok) throw new Error(`fixture did not parse: ${result.reason}`);
  return result.data;
}

describe("normalizeText", () => {
  it("lower-cases and collapses whitespace", () => {
    expect(normalizeText("  Built\tETL\n\n pipelines  ")).toBe("built etl pipelines");
  });

  it("applies NFKC, so ligatures and non-breaking spaces become plain text", () => {
    expect(normalizeText("classi\uFB01cation in ML\uFB02ow")).toBe("classification in mlflow");
    expect(normalizeText("Python,\u00A0SQL")).toBe("python, sql");
  });

  it("maps curly quotes and every dash to plain ASCII", () => {
    expect(normalizeText("\u201Craw\u201D team\u2019s")).toBe('"raw" team\'s');
    expect(normalizeText("2021 \u2013 2023 \u2014 now \u2212 1 \u2011 x")).toBe("2021 - 2023 - now - 1 - x");
  });

  it("removes soft hyphens and zero-width characters", () => {
    expect(normalizeText("inter\u00ADnal\u200B tool\uFEFF")).toBe("internal tool");
  });

  it("joins a word split by a hyphen at a line break", () => {
    expect(normalizeText("data pipe-\nlines")).toBe("data pipelines");
    expect(normalizeText("ex- \r\n  periments")).toBe("experiments");
  });

  it("keeps a hyphen that is not at a line break", () => {
    expect(normalizeText("support-ticket")).toBe("support-ticket");
  });

  it("turns bullet characters into spaces", () => {
    expect(normalizeText("\u2022 Built\n\uF0B7 Led\n\u25AA Wrote \u00B7 Git")).toBe("built led wrote git");
  });
});

describe("containsQuote with text pasted from a PDF", () => {
  for (const [name, quote] of Object.entries(PDF_QUOTES)) {
    it(`finds a clean quote in the PDF text: ${name}`, () => {
      expect(containsQuote(PDF_CV, quote)).toBe(true);
    });
  }

  it("also finds the quotes when the model keeps the PDF characters", () => {
    expect(containsQuote(PDF_CV, "classi\uFB01cation, raising macro-F1")).toBe(true);
    expect(containsQuote(PDF_CV, "cleaned 3 million \u201Craw\u201D log lines")).toBe(true);
  });

  it("still rejects a paraphrase of the PDF text", () => {
    expect(containsQuote(PDF_CV, "Fine-tuned GPT models in PyTorch")).toBe(false);
    expect(containsQuote(PDF_CV, "Built data pipelines in Spark")).toBe(false);
  });

  it("rejects a quote stitched together with an ellipsis", () => {
    expect(containsQuote(PDF_CV, "Fine-tuned BERT models ... raising macro-F1")).toBe(false);
    expect(containsQuote(PDF_CV, "Fine-tuned BERT models \u2026 raising macro-F1")).toBe(false);
  });

  it("ignores punctuation the model adds or drops at the ends of a quote", () => {
    expect(containsQuote(PDF_CV, '"Built data pipelines in Python."')).toBe(true);
    expect(containsQuote(PDF_CV, "raising macro-F1 from 0.71 to 0.83.")).toBe(true);
  });

  it("rejects a quote that is only punctuation", () => {
    expect(containsQuote(PDF_CV, " - . ")).toBe(false);
  });

  it("grounds every requirement of a model answer about the PDF CV", () => {
    const output: LlmOutput = {
      requirements: Object.values(PDF_QUOTES).map((quote) => ({ requirement: quote, kind: "skill", status: "met", evidence: quote })),
      gaps: [],
      rewrites: [],
    };
    expect(applyGroundingCheck(output, PDF_CV, "").ungroundedCount).toBe(0);
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

  it("marks requirements with quotes not in the CV as unverified, drops such rewrites, and counts both", () => {
    const result = applyGroundingCheck(parsed(HALLUCINATED_RAW), CV, JD);
    expect(result.ungroundedCount).toBe(2); // invented Kubernetes quote + invented rewrite source
    expect(result.requirements).toEqual([
      { requirement: "Python", status: "met", evidence: "Built ETL pipelines in Python and SQL at Acme" },
      // The invented quote is not shown.
      { requirement: "Kubernetes", status: "unverified", evidence: null },
    ]);
    expect(result.rewrites).toEqual([]);
  });

  it("leaves unverified requirements out of the score so hallucinations cannot raise it", () => {
    const result = applyGroundingCheck(parsed(HALLUCINATED_RAW), CV, JD);
    expect(result.statusesForScore).toEqual(["met"]);
  });

  it("treats a met requirement with empty evidence as ungrounded", () => {
    const output: LlmOutput = {
      requirements: [{ requirement: "Python", kind: "skill", status: "met", evidence: "" }],
      gaps: [],
      rewrites: [],
    };
    const result = applyGroundingCheck(output, CV, JD);
    expect(result.ungroundedCount).toBe(1);
    expect(result.requirements).toEqual([{ requirement: "Python", status: "unverified", evidence: null }]);
    expect(result.statusesForScore).toEqual([]);
  });

  it("moves traits to their own list and never scores them, whatever status the model gave", () => {
    const output: LlmOutput = {
      requirements: [
        { requirement: "Python", kind: "skill", status: "met", evidence: "Python and SQL" },
        // A weak quote for a trait: it must not count, and is not ungrounded either.
        { requirement: "Excellent communication skills", kind: "trait", status: "met", evidence: "Mentored two junior analysts." },
        { requirement: "Self-starter", kind: "trait", status: "partly_met", evidence: "invented text" },
        { requirement: "Team player", kind: "trait", status: "not_met", evidence: "" },
      ],
      gaps: [],
      rewrites: [],
    };
    const result = applyGroundingCheck(output, CV, JD);
    expect(result.traits).toEqual(["Excellent communication skills", "Self-starter", "Team player"]);
    expect(result.requirements.map((r) => r.requirement)).toEqual(["Python"]);
    expect(result.statusesForScore).toEqual(["met"]);
    expect(result.ungroundedCount).toBe(0);
  });

  it("drops a rewrite that adds facts, without counting it as ungrounded", () => {
    const output: LlmOutput = {
      requirements: [{ requirement: "Docker", kind: "skill", status: "met", evidence: "Docker on AWS" }],
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
