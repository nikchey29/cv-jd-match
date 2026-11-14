import type { Context } from "@netlify/functions";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFeedbackHandler } from "../netlify/functions/feedback";
import { createStatsHandler } from "../netlify/functions/stats";
import { toStats } from "../netlify/lib/db";
import { FixedWindowRateLimiter } from "../netlify/lib/rateLimit";
import { fakeDb } from "./fixtures/fakeDb";

const context = { ip: "203.0.113.7" } as Context;
const ID = "3f1c2b9e-6d7a-4c1e-9f0a-2b3c4d5e6f70";

function postFeedback(body: unknown): Request {
  return new Request("http://localhost/api/feedback", { method: "POST", body: JSON.stringify(body) });
}

beforeEach(() => void vi.spyOn(console, "info").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("POST /api/feedback handler", () => {
  it("updates the row and returns ok", async () => {
    const { db, queries } = fakeDb({ rowCount: 1 });
    const handler = createFeedbackHandler({ getDb: () => db, limiter: new FixedWindowRateLimiter(10, 60_000) });
    const res = await handler(postFeedback({ id: ID, helpful: true }), context);
    expect(res.status).toBe(200);
    expect(queries[0]!.sql).toMatch(/UPDATE match_runs SET helpful/);
    expect(queries[0]!.params).toEqual([ID, true]);
  });

  it("returns 404 when no row has that id", async () => {
    const { db } = fakeDb({ rowCount: 0 });
    const handler = createFeedbackHandler({ getDb: () => db, limiter: new FixedWindowRateLimiter(10, 60_000) });
    expect((await handler(postFeedback({ id: ID, helpful: false }), context)).status).toBe(404);
  });

  it("returns 400 for an invalid body", async () => {
    const { db, queries } = fakeDb();
    const handler = createFeedbackHandler({ getDb: () => db, limiter: new FixedWindowRateLimiter(10, 60_000) });
    expect((await handler(postFeedback({ id: "not-a-uuid", helpful: true }), context)).status).toBe(400);
    expect((await handler(postFeedback({ id: ID }), context)).status).toBe(400);
    expect(queries).toHaveLength(0);
  });

  it("returns 500 when the database fails", async () => {
    const { db } = fakeDb(new Error("down"));
    const handler = createFeedbackHandler({ getDb: () => db, limiter: new FixedWindowRateLimiter(10, 60_000) });
    expect((await handler(postFeedback({ id: ID, helpful: true }), context)).status).toBe(500);
  });

  it("returns 429 when one IP sends too many requests", async () => {
    const { db } = fakeDb({ rowCount: 1 });
    const handler = createFeedbackHandler({ getDb: () => db, limiter: new FixedWindowRateLimiter(1, 60_000) });
    await handler(postFeedback({ id: ID, helpful: true }), context);
    expect((await handler(postFeedback({ id: ID, helpful: true }), context)).status).toBe(429);
  });
});

describe("GET /api/stats handler", () => {
  it("returns the computed stats", async () => {
    const { db } = fakeDb({ rows: [{ total_runs: 4, with_feedback: 2, helpful_count: 1, avg_ungrounded: 0.75 }] });
    const handler = createStatsHandler({ getDb: () => db, limiter: new FixedWindowRateLimiter(10, 60_000) });
    const res = await handler(new Request("http://localhost/api/stats"), context);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ totalRuns: 4, feedbackShare: 0.5, helpfulShare: 0.5, avgUngrounded: 0.75 });
  });

  it("returns 500 when the database is not configured", async () => {
    const handler = createStatsHandler({ getDb: () => null, limiter: new FixedWindowRateLimiter(10, 60_000) });
    expect((await handler(new Request("http://localhost/api/stats"), context)).status).toBe(500);
  });
});

describe("toStats", () => {
  it("returns nulls when there are no runs", () => {
    expect(toStats({ total_runs: 0, with_feedback: 0, helpful_count: 0, avg_ungrounded: null })).toEqual({
      totalRuns: 0,
      feedbackShare: null,
      helpfulShare: null,
      avgUngrounded: null,
    });
  });

  it("computes helpful share only over runs with feedback", () => {
    expect(toStats({ total_runs: 10, with_feedback: 4, helpful_count: 3, avg_ungrounded: 1.2 })).toEqual({
      totalRuns: 10,
      feedbackShare: 0.4,
      helpfulShare: 0.75,
      avgUngrounded: 1.2,
    });
  });
});
