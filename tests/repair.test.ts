import { describe, expect, it, vi } from "vitest";
import { applyRepairAnswers, findUngroundedQuotes } from "../lib/repair";
import { parseRepairOutput, type LlmOutput } from "../lib/schema";
import { analyzeMatch, REPAIR_SKIP_AFTER_MS } from "../netlify/lib/analyze";
import { LlmBusyError, MATCH_FORMAT, REPAIR_FORMAT, type CompleteFn } from "../netlify/lib/llm";
import { CV, GOOD_RAW, JD } from "./fixtures/llm";

/** Model output with one paraphrased quote, one invented quote and one paraphrased rewrite source. */
const NEEDS_REPAIR: LlmOutput = {
  requirements: [
    { requirement: "Python", kind: "skill", status: "met", evidence: "Built ETL pipelines in Python and SQL at Acme" },
    { requirement: "Docker", kind: "skill", status: "met", evidence: "Used Docker to deploy models on AWS" },
    { requirement: "Kubernetes", kind: "skill", status: "partly_met", evidence: "Managed Kubernetes clusters" },
    { requirement: "Airflow", kind: "skill", status: "not_met", evidence: "" },
  ],
  gaps: ["No Kubernetes"],
  rewrites: [{ original: "Mentored 2 junior analysts", rewritten: "Mentored two junior analysts in SQL." }],
};
const NEEDS_REPAIR_RAW = JSON.stringify(NEEDS_REPAIR);

const repairRaw = (answers: Array<{ id: number; quote: string }>) => JSON.stringify({ answers });

function fakeLlm(...answers: Array<string | Error>) {
  const fn = vi.fn<CompleteFn>();
  for (const answer of answers) {
    if (answer instanceof Error) fn.mockRejectedValueOnce(answer);
    else fn.mockResolvedValueOnce(answer);
  }
  return fn;
}

describe("findUngroundedQuotes", () => {
  it("lists only met or partly met quotes and rewrite originals that are not in the CV", () => {
    const quotes = findUngroundedQuotes(NEEDS_REPAIR, CV);
    expect(quotes.map((q) => [q.id, q.kind, q.index, q.quote])).toEqual([
      [1, "evidence", 1, "Used Docker to deploy models on AWS"],
      [2, "evidence", 2, "Managed Kubernetes clusters"],
      [3, "original", 0, "Mentored 2 junior analysts"],
    ]);
    expect(quotes[0]!.claim).toContain("Docker");
  });

  it("ignores traits, even with an invented quote", () => {
    const output: LlmOutput = {
      requirements: [{ requirement: "Self-starter", kind: "trait", status: "met", evidence: "invented text" }],
      gaps: [],
      rewrites: [],
    };
    expect(findUngroundedQuotes(output, CV)).toEqual([]);
  });

  it("returns nothing when every quote is in the CV", () => {
    expect(findUngroundedQuotes(JSON.parse(GOOD_RAW) as LlmOutput, CV)).toEqual([]);
  });
});

describe("parseRepairOutput", () => {
  it("accepts a valid answer", () => {
    expect(parseRepairOutput(repairRaw([{ id: 1, quote: "none" }]))).toEqual({ answers: [{ id: 1, quote: "none" }] });
  });

  it("rejects invalid JSON, a wrong shape and extra fields", () => {
    expect(parseRepairOutput("not json")).toBeNull();
    expect(parseRepairOutput("{}")).toBeNull();
    expect(parseRepairOutput(JSON.stringify({ answers: [{ id: "1", quote: "x" }] }))).toBeNull();
    expect(parseRepairOutput(JSON.stringify({ answers: [{ id: 1, quote: "x", status: "met" }] }))).toBeNull();
  });
});

describe("applyRepairAnswers", () => {
  const quotes = findUngroundedQuotes(NEEDS_REPAIR, CV);

  it("uses a corrected quote only when it is in the CV", () => {
    const { output, fixed } = applyRepairAnswers(
      NEEDS_REPAIR,
      quotes,
      [
        { id: 1, quote: "Deployed models with Docker on AWS." },
        { id: 2, quote: "Ran Kubernetes in production" }, // still invented
      ],
      CV,
    );
    expect(fixed).toBe(1);
    expect(output.requirements[1]!.evidence).toBe("Deployed models with Docker on AWS.");
    expect(output.requirements[2]!.evidence).toBe("Managed Kubernetes clusters"); // unchanged
    expect(NEEDS_REPAIR.requirements[1]!.evidence).toBe("Used Docker to deploy models on AWS"); // input not mutated
  });

  it('turns a requirement into "not met" when the model answers "none"', () => {
    const { output, retracted } = applyRepairAnswers(NEEDS_REPAIR, quotes, [{ id: 2, quote: " None " }], CV);
    expect(retracted).toBe(1);
    expect(output.requirements[2]).toEqual({ requirement: "Kubernetes", kind: "skill", status: "not_met", evidence: "" });
  });

  it('removes a rewrite when the model answers "none" for its original', () => {
    const { output } = applyRepairAnswers(NEEDS_REPAIR, quotes, [{ id: 3, quote: "none" }], CV);
    expect(output.rewrites).toEqual([]);
  });

  it("fixes a rewrite original", () => {
    const { output, fixed } = applyRepairAnswers(
      NEEDS_REPAIR,
      quotes,
      [{ id: 3, quote: "Mentored two junior analysts." }],
      CV,
    );
    expect(fixed).toBe(1);
    expect(output.rewrites[0]!.original).toBe("Mentored two junior analysts.");
  });

  it("ignores unknown ids and leaves unanswered items alone", () => {
    const { output, fixed, retracted } = applyRepairAnswers(NEEDS_REPAIR, quotes, [{ id: 99, quote: "none" }], CV);
    expect([fixed, retracted]).toEqual([0, 0]);
    expect(output).toEqual(NEEDS_REPAIR);
  });
});

describe("analyzeMatch repair pass (mocked LLM)", () => {
  it("makes no repair call when every quote is grounded", async () => {
    const llm = fakeLlm(GOOD_RAW);
    const result = await analyzeMatch(JD, CV, llm);
    expect(llm).toHaveBeenCalledTimes(1);
    expect(result.repair.status).toBe("not_needed");
    expect(result.initialUngroundedCount).toBe(0);
  });

  it("makes ONE follow-up call that lists only the ungrounded items", async () => {
    const llm = fakeLlm(NEEDS_REPAIR_RAW, repairRaw([]));
    await analyzeMatch(JD, CV, llm);
    expect(llm).toHaveBeenCalledTimes(2);
    const [messages, format] = llm.mock.calls[1]!;
    expect(format).toBe(REPAIR_FORMAT);
    const user = messages[1]!.content as string;
    expect(user).toContain(CV);
    expect(user).not.toContain(JD);
    const items = user.slice(user.indexOf("<items>"));
    expect(items.match(/<item id=/g)).toHaveLength(3);
    expect(items).toContain("Used Docker to deploy models on AWS");
    expect(items).toContain("Managed Kubernetes clusters");
    expect(items).toContain("Mentored 2 junior analysts");
    // The grounded Python item and the not-met Airflow item are not sent.
    expect(items).not.toContain("Python");
    expect(items).not.toContain("Airflow");
    // The first call used the main format.
    expect(llm.mock.calls[0]![1] ?? MATCH_FORMAT).toBe(MATCH_FORMAT);
  });

  it("re-checks the answers: fixed quotes count, invented ones stay ungrounded", async () => {
    const llm = fakeLlm(
      NEEDS_REPAIR_RAW,
      repairRaw([
        { id: 1, quote: "Deployed models with   Docker on AWS." },
        { id: 2, quote: "Kubernetes on AWS" }, // not in the CV
        { id: 3, quote: "none" },
      ]),
    );
    const result = await analyzeMatch(JD, CV, llm);
    expect(result.initialUngroundedCount).toBe(3);
    expect(result.repair).toEqual({ status: "done", fixed: 1, retracted: 1, errorName: null });
    expect(result.ungroundedCount).toBe(1); // only Kubernetes is still ungrounded
    expect(result.requirements.find((r) => r.requirement === "Docker")?.evidence).toBe(
      "Deployed models with   Docker on AWS.",
    );
    expect(result.rewrites).toEqual([]);
  });

  it("keeps the result when the repair answer is invalid, with no further calls", async () => {
    const llm = fakeLlm(NEEDS_REPAIR_RAW, "not json", GOOD_RAW);
    const result = await analyzeMatch(JD, CV, llm);
    expect(llm).toHaveBeenCalledTimes(2);
    expect(result.repair.status).toBe("failed");
    expect(result.ungroundedCount).toBe(3);
  });

  it("keeps the result when the repair call is still rate limited after retries", async () => {
    const llm = fakeLlm(NEEDS_REPAIR_RAW, new LlmBusyError());
    const result = await analyzeMatch(JD, CV, llm);
    expect(result.repair).toEqual({ status: "failed", fixed: 0, retracted: 0, errorName: "LlmBusyError" });
    expect(result.ungroundedCount).toBe(3);
  });

  it("leaves traits out of the score and makes no repair call for them", async () => {
    const output: LlmOutput = {
      requirements: [
        { requirement: "Python", kind: "skill", status: "met", evidence: "Python and SQL" },
        { requirement: "Kubernetes", kind: "skill", status: "not_met", evidence: "" },
        { requirement: "Excellent communication skills", kind: "trait", status: "met", evidence: "Mentored" },
      ],
      gaps: [],
      rewrites: [],
    };
    const llm = fakeLlm(JSON.stringify(output));
    const result = await analyzeMatch(JD, CV, llm);
    expect(llm).toHaveBeenCalledTimes(1);
    expect(result.traits).toEqual(["Excellent communication skills"]);
    expect(result.score).toBe(50); // Python met, Kubernetes not met; the trait is not scored
    expect(result.scoredCount).toBe(2);
    expect(result.requirementCount).toBe(3);
  });

  it("skips the repair pass when the first call already took too long", async () => {
    const llm = fakeLlm(NEEDS_REPAIR_RAW);
    const now = vi.fn().mockReturnValueOnce(0).mockReturnValue(REPAIR_SKIP_AFTER_MS + 1);
    const result = await analyzeMatch(JD, CV, llm, { now });
    expect(llm).toHaveBeenCalledTimes(1);
    expect(result.repair.status).toBe("skipped");
    expect(result.ungroundedCount).toBe(3);
  });
});
