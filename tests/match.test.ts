import type { Context } from "@netlify/functions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchResponse } from "../lib/schema";
import { createMatchHandler, MESSAGES, type MatchDeps } from "../netlify/functions/match";
import { LlmBusyError, type CompleteFn } from "../netlify/lib/llm";
import { FixedWindowRateLimiter } from "../netlify/lib/rateLimit";
import { fakeDb } from "./fixtures/fakeDb";
import { CV, GOOD_RAW, JD, NOT_JSON_RAW } from "./fixtures/llm";

const context = { ip: "203.0.113.7" } as Context;

function post(body: unknown): Request {
  return new Request("http://localhost/api/match", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

let database: ReturnType<typeof fakeDb>;

function setup(complete: CompleteFn, overrides: Partial<MatchDeps> = {}) {
  const deps: MatchDeps = {
    getLlm: () => ({ complete, model: "test-model" }),
    getDb: () => database.db,
    limiter: new FixedWindowRateLimiter(100, 60_000),
    now: vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_850),
    ...overrides,
  };
  return createMatchHandler(deps);
}

let logs: string[];
beforeEach(() => {
  logs = [];
  database = fakeDb();
  vi.spyOn(console, "info").mockImplementation((line: string) => void logs.push(line));
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/match handler (mocked LLM)", () => {
  it("returns the analysis with an id, model and latency", async () => {
    const res = await setup(async () => GOOD_RAW)(post({ jd: JD, cv: CV }), context);
    expect(res.status).toBe(200);
    const body = (await res.json()) as MatchResponse;
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.score).toBe(63);
    expect(body.model).toBe("test-model");
    expect(body.latencyMs).toBe(850);
    expect(body.ungroundedCount).toBe(0);
  });

  it("saves one row with only numbers and the model name", async () => {
    const res = await setup(async () => GOOD_RAW)(post({ jd: JD, cv: CV }), context);
    const body = (await res.json()) as MatchResponse;
    expect(database.queries).toHaveLength(1);
    expect(database.queries[0]!.sql).toMatch(/INSERT INTO match_runs/);
    expect(database.queries[0]!.params).toEqual([body.id, 63, 4, 0, 850, "test-model"]);
  });

  it("never sends the JD or CV text to the database", async () => {
    await setup(async () => GOOD_RAW)(post({ jd: JD, cv: CV }), context);
    const sent = JSON.stringify(database.queries);
    for (const line of [...JD.split("\n"), ...CV.split("\n")]) expect(sent).not.toContain(line.trim());
  });

  it("still returns the result, with id null, when saving fails", async () => {
    database = fakeDb(new Error("connection refused"));
    const res = await setup(async () => GOOD_RAW)(post({ jd: JD, cv: CV }), context);
    expect(res.status).toBe(200);
    const body = (await res.json()) as MatchResponse;
    expect(body.id).toBeNull();
    expect(body.score).toBe(63);
    expect(logs.join("\n")).not.toContain("connection refused");
  });

  it("does not save anything when the LLM fails", async () => {
    await setup(async () => NOT_JSON_RAW)(post({ jd: JD, cv: CV }), context);
    expect(database.queries).toHaveLength(0);
  });

  it("never writes the JD or CV text to the logs", async () => {
    await setup(async () => GOOD_RAW)(post({ jd: JD, cv: CV }), context);
    const all = logs.join("\n");
    expect(all).toContain("match_ok");
    expect(all).not.toContain("Acme");
    expect(all).not.toContain("Kubernetes");
    expect(all).not.toContain(context.ip);
  });

  it("rejects empty input with 400", async () => {
    const res = await setup(async () => GOOD_RAW)(post({ jd: "  ", cv: CV }), context);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Job description is empty." });
  });

  it("rejects input over 20,000 characters with 400", async () => {
    const res = await setup(async () => GOOD_RAW)(post({ jd: JD, cv: "a".repeat(20_001) }), context);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/longer than 20,000/);
  });

  it("rejects a body that is not JSON with 400", async () => {
    const res = await setup(async () => GOOD_RAW)(post("{not json"), context);
    expect(res.status).toBe(400);
  });

  it("returns 413 with a friendly message when JD + CV exceed the token budget", async () => {
    const complete = vi.fn<CompleteFn>();
    const big = "word ".repeat(3_900); // 19,500 characters, valid on its own
    const res = await setup(complete)(post({ jd: big, cv: big }), context);
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toMatch(/too long for the free LLM tier/);
    expect(complete).not.toHaveBeenCalled();
  });

  it("returns 503 with the busy message when Groq stays rate limited", async () => {
    const res = await setup(async () => {
      throw new LlmBusyError();
    })(post({ jd: JD, cv: CV }), context);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: MESSAGES.busy });
  });

  it("returns 502 after two invalid LLM answers", async () => {
    const res = await setup(async () => NOT_JSON_RAW)(post({ jd: JD, cv: CV }), context);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: MESSAGES.invalidOutput });
  });

  it("returns 500 when the API key is not configured", async () => {
    const res = await setup(async () => GOOD_RAW, { getLlm: () => null })(post({ jd: JD, cv: CV }), context);
    expect(res.status).toBe(500);
  });

  it("returns 429 when one IP sends too many requests", async () => {
    const handler = setup(async () => GOOD_RAW, { limiter: new FixedWindowRateLimiter(1, 60_000) });
    expect((await handler(post({ jd: " ", cv: " " }), context)).status).toBe(400);
    const res = await handler(post({ jd: JD, cv: CV }), context);
    expect(res.status).toBe(429);
  });
});
