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
    traits: [],
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
  it("has 12 valid cases covering strong, weak and hallucination traps", async () => {
    const files = (await readdir(casesDir)).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(12);
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

describe("regression cases for grounding and traits", () => {
  const load = async (id: string) =>
    EvalCaseSchema.parse(JSON.parse(await readFile(path.join(casesDir, `${id}.json`), "utf8")));

  it("11 is a CV pasted from a PDF, full of the characters that broke grounding", async () => {
    const c = await load("11-pdf-paste-strong");
    expect(c.expect.maxUngrounded).toBe(0);
    for (const ch of ["\uFB01", "\uFB02", "\u00AD", "\u2022", "\u201C", "\u2013", "\u00A0", "\u200B"]) {
      expect(c.cv).toContain(ch);
    }
    expect(c.cv).toMatch(/[a-z]-\n[a-z]/); // a word split at a line break
  });

  it("12 mixes traits with skills and expects the traits listed apart", async () => {
    const c = await load("12-trap-traits-weak-evidence");
    expect(c.expect.traits).toEqual(["self-starter", "communication", "passion", "team player"]);
  });
});

describe("checkExpectations: grounding and traits", () => {
  it("fails when too many quotes are still ungrounded", () => {
    expect(checkExpectations({ ...baseCase, expect: { maxUngrounded: 0 } }, result({ ungroundedCount: 2 }))).toEqual([
      "2 ungrounded > 0",
    ]);
  });

  it("fails when a trait keyword is not in the trait list, even if scored as a skill", () => {
    const res = result({
      traits: ["Self-starter who works independently"],
      requirements: [{ requirement: "Excellent communication skills", status: "met", evidence: "Presented" }],
    });
    expect(
      checkExpectations({ ...baseCase, expect: { traits: ["self-starter", "communication"] } }, res),
    ).toEqual(['"communication" not listed as a trait']);
  });

  it("reports a missing score when a score band is expected", () => {
    expect(checkExpectations({ ...baseCase, expect: { minScore: 70 } }, result({ score: null }))).toEqual(["no score"]);
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
      initialUngroundedCount: 3,
      ungroundedCount: 1,
      unverifiedCount: 1,
      traitCount: 2,
      repairStatus: "done",
      unsupportedRewriteCount: 0,
      latencyMs: 1234,
      expectationMet: true,
      expectationNotes: [],
      error: null,
    };
    const md = toMarkdown([row], "model-x", "2026-01-01T00:00:00.000Z");
    expect(md).toContain("| 01-a | strong | yes | yes | 3 | 1 | done | 2 | 0 | 1234 | 80 | pass |");
    expect(md).toContain("- Ungrounded quotes, total before / after repair: 3 / 1");
    expect(md).toContain("- Schema-valid rate: 1/1");
  });
});
