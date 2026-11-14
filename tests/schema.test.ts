import { describe, expect, it } from "vitest";
import {
  FeedbackRequestSchema,
  MatchRequestSchema,
  MAX_INPUT_CHARS,
  llmOutputJsonSchema,
  parseLlmOutput,
} from "../lib/schema";
import { BAD_STATUS_RAW, GOOD_OUTPUT, GOOD_RAW, NOT_JSON_RAW, WRONG_SHAPE_RAW } from "./fixtures/llm";

describe("parseLlmOutput (mocked LLM responses)", () => {
  it("accepts a valid response", () => {
    const result = parseLlmOutput(GOOD_RAW);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.requirements).toHaveLength(4);
  });

  it("reports text that is not JSON", () => {
    expect(parseLlmOutput(NOT_JSON_RAW)).toEqual({ ok: false, reason: "invalid_json" });
  });

  it("reports truncated JSON", () => {
    expect(parseLlmOutput(GOOD_RAW.slice(0, 40))).toEqual({ ok: false, reason: "invalid_json" });
  });

  it("reports JSON with the wrong shape", () => {
    expect(parseLlmOutput(WRONG_SHAPE_RAW)).toEqual({ ok: false, reason: "schema_mismatch" });
  });

  it("reports an unknown status value", () => {
    expect(parseLlmOutput(BAD_STATUS_RAW)).toEqual({ ok: false, reason: "schema_mismatch" });
  });

  it("rejects extra fields, such as a model-computed score", () => {
    const raw = JSON.stringify({ ...GOOD_OUTPUT, score: 95 });
    expect(parseLlmOutput(raw)).toEqual({ ok: false, reason: "schema_mismatch" });
  });

  it("rejects more than 5 rewrites", () => {
    const rewrite = GOOD_OUTPUT.rewrites[0]!;
    const raw = JSON.stringify({ ...GOOD_OUTPUT, rewrites: Array(6).fill(rewrite) });
    expect(parseLlmOutput(raw)).toEqual({ ok: false, reason: "schema_mismatch" });
  });

  it("rejects an empty requirement list", () => {
    const raw = JSON.stringify({ ...GOOD_OUTPUT, requirements: [] });
    expect(parseLlmOutput(raw)).toEqual({ ok: false, reason: "schema_mismatch" });
  });
});

describe("llmOutputJsonSchema", () => {
  it("is strict: every field required and no extra properties", () => {
    expect(llmOutputJsonSchema.additionalProperties).toBe(false);
    expect(llmOutputJsonSchema.required).toEqual(["requirements", "gaps", "rewrites"]);
  });
});

describe("MatchRequestSchema", () => {
  it("accepts normal input and trims it", () => {
    const result = MatchRequestSchema.safeParse({ jd: "  Need Python ", cv: "Python dev" });
    expect(result.success && result.data.jd).toBe("Need Python");
  });

  it("rejects empty or whitespace-only text", () => {
    expect(MatchRequestSchema.safeParse({ jd: "", cv: "x" }).success).toBe(false);
    expect(MatchRequestSchema.safeParse({ jd: "x", cv: "  \n " }).success).toBe(false);
  });

  it("accepts exactly 20,000 characters and rejects 20,001", () => {
    const ok = "a".repeat(MAX_INPUT_CHARS);
    expect(MatchRequestSchema.safeParse({ jd: ok, cv: ok }).success).toBe(true);
    expect(MatchRequestSchema.safeParse({ jd: ok + "a", cv: "x" }).success).toBe(false);
  });

  it("rejects missing or non-string fields", () => {
    expect(MatchRequestSchema.safeParse({ jd: "x" }).success).toBe(false);
    expect(MatchRequestSchema.safeParse({ jd: 1, cv: "x" }).success).toBe(false);
  });
});

describe("FeedbackRequestSchema", () => {
  it("accepts a UUID and a boolean", () => {
    const body = { id: "3f1c2b9e-6d7a-4c1e-9f0a-2b3c4d5e6f70", helpful: false };
    expect(FeedbackRequestSchema.safeParse(body).success).toBe(true);
  });

  it("rejects a bad id or a non-boolean helpful", () => {
    expect(FeedbackRequestSchema.safeParse({ id: "abc", helpful: true }).success).toBe(false);
    expect(
      FeedbackRequestSchema.safeParse({ id: "3f1c2b9e-6d7a-4c1e-9f0a-2b3c4d5e6f70", helpful: "yes" }).success,
    ).toBe(false);
  });
});
