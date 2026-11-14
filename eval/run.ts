// Usage: npm run eval
// Runs every case in eval/cases against the real Groq API using the same
// pipeline as /api/match (budget check, LLM, retry, grounding, score).
// It does not touch the database. Writes eval/results.json and eval/RESULTS.md.
//
// Optional environment variables:
//   EVAL_DELAY_MS  pause between cases (default 20000) to stay inside Groq's free limits
//   EVAL_ONLY      comma-separated case ids to run a subset
//   EVAL_OUT_DIR   where to write results (default: the eval folder)
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { analyzeMatch, type AnalysisResult } from "../netlify/lib/analyze";
import { getLlmConfig } from "../netlify/lib/config";
import { createGroqComplete } from "../netlify/lib/llm";

const EVAL_DIR = path.dirname(fileURLToPath(import.meta.url));

export const EvalCaseSchema = z.object({
  id: z.string(),
  category: z.enum(["strong", "weak", "hallucination_trap"]),
  description: z.string(),
  jd: z.string(),
  cv: z.string(),
  expect: z.object({
    minScore: z.number().optional(),
    maxScore: z.number().optional(),
    /** Keywords: any requirement mentioning one must not be shown as met or partly met. */
    notMet: z.array(z.string()).optional(),
    /** At most this many quotes may still be ungrounded after the repair pass. */
    maxUngrounded: z.number().optional(),
    /** Keywords that must each appear in the "Not checkable from a CV" (trait) list. */
    traits: z.array(z.string()).optional(),
  }),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export interface CaseResult {
  id: string;
  category: EvalCase["category"];
  /** The pipeline produced schema-valid output (after at most one retry). */
  schemaValid: boolean;
  /** The first answer was already schema-valid. */
  firstAttemptValid: boolean;
  score: number | null;
  /** Quotes not found in the CV before the repair pass. */
  initialUngroundedCount: number | null;
  /** Quotes still not found after the repair pass. */
  ungroundedCount: number | null;
  /** Requirements shown as unverified (part of ungroundedCount). */
  unverifiedCount: number | null;
  traitCount: number | null;
  repairStatus: AnalysisResult["repair"]["status"] | null;
  unsupportedRewriteCount: number | null;
  latencyMs: number;
  expectationMet: boolean;
  expectationNotes: string[];
  /** Error class name when the case failed, e.g. LlmBusyError. */
  error: string | null;
}

/** Compare one result to the case's expectations. Returns the reasons it failed, if any. */
export function checkExpectations(evalCase: EvalCase, result: AnalysisResult): string[] {
  const notes: string[] = [];
  const { minScore, maxScore, notMet, maxUngrounded, traits } = evalCase.expect;
  if ((minScore !== undefined || maxScore !== undefined) && result.score === null) notes.push("no score");
  if (minScore !== undefined && result.score !== null && result.score < minScore)
    notes.push(`score ${result.score} < ${minScore}`);
  if (maxScore !== undefined && result.score !== null && result.score > maxScore)
    notes.push(`score ${result.score} > ${maxScore}`);
  for (const keyword of notMet ?? []) {
    const wronglyMet = result.requirements.find(
      (r) => r.status !== "not_met" && r.requirement.toLowerCase().includes(keyword.toLowerCase()),
    );
    if (wronglyMet) notes.push(`"${keyword}" marked ${wronglyMet.status}`);
  }
  if (maxUngrounded !== undefined && result.ungroundedCount > maxUngrounded)
    notes.push(`${result.ungroundedCount} ungrounded > ${maxUngrounded}`);
  for (const keyword of traits ?? []) {
    if (!result.traits.some((t) => t.toLowerCase().includes(keyword.toLowerCase())))
      notes.push(`"${keyword}" not listed as a trait`);
  }
  return notes;
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

const fmt = (value: number | null, digits = 0) => (value === null ? "–" : value.toFixed(digits));
const sum = (values: Array<number | null>) => values.reduce<number>((a, b) => a + (b ?? 0), 0);

/** Build the Markdown report from case results. */
export function toMarkdown(results: CaseResult[], model: string, date: string): string {
  const valid = results.filter((r) => r.schemaValid);
  const rows = results.map(
    (r) =>
      `| ${r.id} | ${r.category} | ${r.schemaValid ? "yes" : "no"} | ${r.firstAttemptValid ? "yes" : "no"} | ` +
      `${fmt(r.initialUngroundedCount)} | ${fmt(r.ungroundedCount)} | ${r.repairStatus ?? "–"} | ${fmt(r.traitCount)} | ` +
      `${fmt(r.unsupportedRewriteCount)} | ${r.latencyMs} | ${fmt(r.score)} | ` +
      `${r.expectationMet ? "pass" : "fail"}${r.expectationNotes.length ? ` (${r.expectationNotes.join("; ")})` : ""} |`,
  );
  return [
    "# Evaluation results",
    "",
    `Model: \`${model}\` · Run: ${date} · Cases: ${results.length}`,
    "",
    "| Case | Category | Schema-valid | Valid on 1st try | Ungrounded before repair | Ungrounded after repair | Repair | Traits | Unsupported rewrites | Latency (ms) | Score | Expectation |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "## Summary",
    "",
    `- Schema-valid rate: ${valid.length}/${results.length}`,
    `- Valid on first try: ${results.filter((r) => r.firstAttemptValid).length}/${results.length}`,
    `- Ungrounded quotes, total before / after repair: ${sum(valid.map((r) => r.initialUngroundedCount))} / ${sum(valid.map((r) => r.ungroundedCount))}`,
    `- Ungrounded quotes after repair per case (mean): ${fmt(mean(valid.map((r) => r.ungroundedCount ?? 0)), 2)}`,
    `- Latency (mean ms): ${fmt(mean(valid.map((r) => r.latencyMs)))}`,
    `- Expectations met: ${results.filter((r) => r.expectationMet).length}/${results.length}`,
    "",
  ].join("\n");
}

async function loadCases(only: string[] | null): Promise<EvalCase[]> {
  const dir = path.join(EVAL_DIR, "cases");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const cases = await Promise.all(
    files.map(async (f) => EvalCaseSchema.parse(JSON.parse(await readFile(path.join(dir, f), "utf8")))),
  );
  return only ? cases.filter((c) => only.includes(c.id)) : cases;
}

async function main(): Promise<void> {
  const config = getLlmConfig();
  if (!config) {
    console.error("GROQ_API_KEY is not set. Add it to .env first.");
    process.exit(1);
  }
  const delayMs = Number(process.env.EVAL_DELAY_MS ?? 20_000);
  const only = process.env.EVAL_ONLY ? process.env.EVAL_ONLY.split(",").map((s) => s.trim()) : null;
  const outDir = process.env.EVAL_OUT_DIR ?? EVAL_DIR;

  const cases = await loadCases(only);
  const complete = createGroqComplete(config.apiKey, config.model);
  const results: CaseResult[] = [];

  for (const [index, evalCase] of cases.entries()) {
    if (index > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    const started = performance.now();
    try {
      const result = await analyzeMatch(evalCase.jd, evalCase.cv, complete);
      const notes = checkExpectations(evalCase, result);
      results.push({
        id: evalCase.id,
        category: evalCase.category,
        schemaValid: true,
        firstAttemptValid: result.attempts === 1,
        score: result.score,
        initialUngroundedCount: result.initialUngroundedCount,
        ungroundedCount: result.ungroundedCount,
        unverifiedCount: result.requirements.filter((r) => r.status === "unverified").length,
        traitCount: result.traits.length,
        repairStatus: result.repair.status,
        unsupportedRewriteCount: result.unsupportedRewriteCount,
        latencyMs: Math.round(performance.now() - started),
        expectationMet: notes.length === 0,
        expectationNotes: notes,
        error: null,
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      results.push({
        id: evalCase.id,
        category: evalCase.category,
        schemaValid: false,
        firstAttemptValid: false,
        score: null,
        initialUngroundedCount: null,
        ungroundedCount: null,
        unverifiedCount: null,
        traitCount: null,
        repairStatus: null,
        unsupportedRewriteCount: null,
        latencyMs: Math.round(performance.now() - started),
        expectationMet: false,
        expectationNotes: [name],
        error: name,
      });
    }
    const last = results.at(-1)!;
    console.info(
      `[${index + 1}/${cases.length}] ${last.id}: ${last.error ?? `score ${last.score}, ungrounded ${last.initialUngroundedCount} -> ${last.ungroundedCount} (repair ${last.repairStatus}), traits ${last.traitCount}, ${last.latencyMs} ms, expectation ${last.expectationMet ? "pass" : "fail"}${last.expectationNotes.length ? ` (${last.expectationNotes.join("; ")})` : ""}`}`,
    );
  }

  const date = new Date().toISOString();
  await writeFile(
    path.join(outDir, "results.json"),
    JSON.stringify({ model: config.model, date, results }, null, 2) + "\n",
  );
  await writeFile(path.join(outDir, "RESULTS.md"), toMarkdown(results, config.model, date));
  console.info(`Wrote ${path.join(outDir, "results.json")} and RESULTS.md`);
}

// Run only when executed directly (tests import the helpers above).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
