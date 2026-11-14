import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AnalysisResult } from "../netlify/lib/analyze";
import { checkExpectations, EvalCaseSchema, toMarkdown, type CaseResult, type EvalCase } from "../eval/run";

const casesDir = path.join(import.meta.dirname, "..", "eval", "cases");

function result(overrides: Partial<AnalysisResult>): AnalysisResult {
  return {
    score: 50,
    scoredCount: 0,
    requirements: [],
    gaps: [],
    rewrites: [],
    requirementCount: 0,
    ungroundedCount: 0,
    initialUngroundedCount: 0,
    unsupportedRewriteCount: 0,
    attempts: 1,
    repair: { status: "not_needed", fixed: 0, retracted: 0, errorName: null },
    ...overrides,
  };
}

const baseCase: EvalCase = { id: "x", category: "strong", description: "", jd: "", cv: "", expect: {} };

describe("eval cases", () => {
  it("has 10 valid cases covering strong, weak and hallucination traps", async () => {
    const files = (await readdir(casesDir)).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(10);
    const cases = await Promise.all(
      files.map(async (f) => EvalCaseSchema.parse(JSON.parse(await readFile(path.join(casesDir, f), "utf8")))),
    );
    const categories = new Set(cases.map((c) => c.category));
    expect(categories).toEqual(new Set(["strong", "weak", "hallucination_trap"]));
    for (const c of cases) expect(files).toContain(`${c.id}.json`); // file name matches id
  });
});

describe("checkExpectations", () => {
  it("passes when the score is inside the band", () => {
    expect(checkExpectations({ ...baseCase, expect: { minScore: 70 } }, result({ score: 80 }))).toEqual([]);
  });

  it("fails when the score is outside the band", () => {
    expect(checkExpectations({ ...baseCase, expect: { maxScore: 40 } }, result({ score: 60 }))).toEqual([
      "score 60 > 40",
    ]);
  });

  it("fails when a trap requirement is marked met or partly met", () => {
    const res = result({
      requirements: [
        { requirement: "Kubernetes", status: "partly_met", evidence: "learn Kubernetes" },
        { requirement: "Apache Spark", status: "not_met", evidence: null },
      ],
    });
    expect(checkExpectations({ ...baseCase, expect: { notMet: ["kubernetes", "spark"] } }, res)).toEqual([
      '"kubernetes" marked partly_met',
    ]);
  });
});

describe("toMarkdown", () => {
  it("renders a row per case and a summary", () => {
    const row: CaseResult = {
      id: "01-a",
      category: "strong",
      schemaValid: true,
      firstAttemptValid: true,
      score: 80,
      ungroundedCount: 1,
      unsupportedRewriteCount: 0,
      latencyMs: 1234,
      expectationMet: true,
      expectationNotes: [],
      error: null,
    };
    const md = toMarkdown([row], "model-x", "2026-01-01T00:00:00.000Z");
    expect(md).toContain("| 01-a | strong | yes | yes | 1 | 0 | 1234 | 80 | pass |");
    expect(md).toContain("- Schema-valid rate: 1/1");
  });
});
