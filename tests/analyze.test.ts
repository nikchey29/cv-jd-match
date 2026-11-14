import { describe, expect, it, vi } from "vitest";
import { analyzeMatch, InputTooLargeError, INPUT_TOKEN_BUDGET } from "../netlify/lib/analyze";
import { InvalidLlmOutputError, type CompleteFn } from "../netlify/lib/llm";
import { CV, GOOD_RAW, HALLUCINATED_RAW, JD, NOT_JSON_RAW, WRONG_SHAPE_RAW } from "./fixtures/llm";

/** A fake LLM that returns the given answers in order. */
function fakeLlm(...answers: Array<string | Error>) {
  const fn = vi.fn<CompleteFn>();
  for (const answer of answers) {
    if (answer instanceof Error) fn.mockRejectedValueOnce(answer);
    else fn.mockResolvedValueOnce(answer);
  }
  return fn;
}

describe("analyzeMatch (mocked LLM)", () => {
  it("returns a grounded result with a score computed in code", async () => {
    const llm = fakeLlm(GOOD_RAW);
    const result = await analyzeMatch(JD, CV, llm);
    // met + met + partly_met + not_met = 2.5 / 4 = 62.5 -> 63
    expect(result.score).toBe(63);
    expect(result.requirementCount).toBe(4);
    expect(result.ungroundedCount).toBe(0);
    expect(result.attempts).toBe(1);
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("sends the JD and CV inside the user message", async () => {
    const llm = fakeLlm(GOOD_RAW);
    await analyzeMatch(JD, CV, llm);
    const messages = llm.mock.calls[0]![0];
    expect(messages[0]!.role).toBe("system");
    expect(messages[1]!.content).toContain(JD);
    expect(messages[1]!.content).toContain(CV);
  });

  it("marks quotes still not found after the repair pass as unverified and leaves them out of the score", async () => {
    // The repair pass finds nothing better.
    const llm = fakeLlm(HALLUCINATED_RAW, JSON.stringify({ answers: [{ id: 1, quote: "Kubernetes clusters" }] }));
    const result = await analyzeMatch(JD, CV, llm);
    expect(result.ungroundedCount).toBe(2);
    expect(result.requirements.map((r) => r.status)).toEqual(["met", "unverified"]);
    expect(result.score).toBe(100); // only Python is scored
    expect(result.scoredCount).toBe(1);
    expect(result.requirementCount).toBe(2);
  });

  it("has no score when every requirement is unverified", async () => {
    const output = {
      requirements: [{ requirement: "Kubernetes", kind: "skill", status: "met", evidence: "Managed Kubernetes clusters" }],
      gaps: [],
      rewrites: [],
    };
    const llm = fakeLlm(JSON.stringify(output), JSON.stringify({ answers: [] }));
    const result = await analyzeMatch(JD, CV, llm);
    expect(result.score).toBeNull();
    expect(result.scoredCount).toBe(0);
    expect(result.ungroundedCount).toBe(1);
  });

  it("scores a retracted requirement as not met", async () => {
    const llm = fakeLlm(HALLUCINATED_RAW, JSON.stringify({ answers: [{ id: 1, quote: "none" }] }));
    const result = await analyzeMatch(JD, CV, llm);
    expect(result.requirements.map((r) => r.status)).toEqual(["met", "not_met"]);
    expect(result.score).toBe(50);
    expect(result.ungroundedCount).toBe(1); // the invented rewrite source is still ungrounded
  });

  it("retries once when the first answer is not JSON", async () => {
    const llm = fakeLlm(NOT_JSON_RAW, GOOD_RAW);
    const result = await analyzeMatch(JD, CV, llm);
    expect(result.attempts).toBe(2);
    expect(llm).toHaveBeenCalledTimes(2);
    const retryMessages = llm.mock.calls[1]![0];
    expect(retryMessages.at(-1)!.content).toMatch(/not valid JSON/);
  });

  it("retries once when the first answer has the wrong shape", async () => {
    const result = await analyzeMatch(JD, CV, fakeLlm(WRONG_SHAPE_RAW, GOOD_RAW));
    expect(result.attempts).toBe(2);
  });

  it("retries once when Groq reports a schema validation failure", async () => {
    const result = await analyzeMatch(JD, CV, fakeLlm(new InvalidLlmOutputError(), GOOD_RAW));
    expect(result.attempts).toBe(2);
  });

  it("throws InvalidLlmOutputError after two invalid answers, with no third call", async () => {
    const llm = fakeLlm(NOT_JSON_RAW, WRONG_SHAPE_RAW, GOOD_RAW);
    await expect(analyzeMatch(JD, CV, llm)).rejects.toBeInstanceOf(InvalidLlmOutputError);
    expect(llm).toHaveBeenCalledTimes(2);
  });

  it("refuses input above the token budget without calling the LLM", async () => {
    const llm = fakeLlm(GOOD_RAW);
    const longText = "word ".repeat(INPUT_TOKEN_BUDGET * 2);
    await expect(analyzeMatch(longText, CV, llm)).rejects.toBeInstanceOf(InputTooLargeError);
    expect(llm).not.toHaveBeenCalled();
  });

  it("passes other LLM errors through", async () => {
    await expect(analyzeMatch(JD, CV, fakeLlm(new Error("network down")))).rejects.toThrow("network down");
  });
});
