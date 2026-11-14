// Runs against a real Postgres when TEST_DATABASE_URL is set (CI sets it).
// Everything happens in a throw-away schema that is dropped afterwards.
import { randomUUID } from "node:crypto";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getStats, insertMatchRun, setFeedback } from "../netlify/lib/db";
import { runMigrations } from "../scripts/migrations";

const url = process.env.TEST_DATABASE_URL;
const schema = `test_${randomUUID().replaceAll("-", "")}`;

describe.runIf(url)("database (real Postgres)", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    const admin = new pg.Client({ connectionString: url });
    await admin.connect();
    await admin.query(`CREATE SCHEMA ${schema}`);
    await admin.end();
    pool = new pg.Pool({ connectionString: url, options: `-c search_path=${schema}` });
  });

  afterAll(async () => {
    await pool?.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool?.end();
  });

  it("applies the migration once and is safe to run again", async () => {
    const client = await pool.connect();
    try {
      expect(await runMigrations(client, path.join(import.meta.dirname, "..", "db"))).toEqual([
        "001_create_match_runs.sql",
      ]);
      expect(await runMigrations(client, path.join(import.meta.dirname, "..", "db"))).toEqual([]);
    } finally {
      client.release();
    }
  });

  it("has no column that could hold JD or CV text", async () => {
    const { rows } = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'match_runs' ORDER BY ordinal_position",
      [schema],
    );
    expect(rows.map((r) => r.column_name)).toEqual([
      "id",
      "created_at",
      "score",
      "requirement_count",
      "ungrounded_count",
      "latency_ms",
      "model",
      "helpful",
      "feedback_at",
    ]);
  });

  it("inserts runs, records feedback and computes stats", async () => {
    const empty = await getStats(pool);
    expect(empty).toEqual({ totalRuns: 0, feedbackShare: null, helpfulShare: null, avgUngrounded: null });

    const a = randomUUID();
    const b = randomUUID();
    await insertMatchRun(pool, { id: a, score: 80, requirementCount: 5, ungroundedCount: 1, latencyMs: 1200, model: "m" });
    await insertMatchRun(pool, { id: b, score: 20, requirementCount: 4, ungroundedCount: 0, latencyMs: 900, model: "m" });

    expect(await setFeedback(pool, a, true)).toBe(true);
    expect(await setFeedback(pool, randomUUID(), true)).toBe(false);

    expect(await getStats(pool)).toEqual({ totalRuns: 2, feedbackShare: 0.5, helpfulShare: 1, avgUngrounded: 0.5 });

    const { rows } = await pool.query("SELECT helpful, feedback_at FROM match_runs WHERE id = $1", [a]);
    expect(rows[0].helpful).toBe(true);
    expect(rows[0].feedback_at).toBeInstanceOf(Date);
  });

  it("rejects a score outside 0-100", async () => {
    await expect(
      insertMatchRun(pool, { id: randomUUID(), score: 101, requirementCount: 1, ungroundedCount: 0, latencyMs: 1, model: "m" }),
    ).rejects.toThrow();
  });
});
