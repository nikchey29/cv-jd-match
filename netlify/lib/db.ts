import pg from "pg";
import type { StatsResponse } from "../../lib/schema";
import { logEvent } from "./log";

/** The one method we need from pg.Pool, so tests can pass a fake. */
export type Queryable = Pick<pg.Pool, "query">;

let pool: pg.Pool | null = null;

/**
 * One connection pool per warm function instance. Returns null when
 * DATABASE_URL is not set. Neon connection strings include sslmode=require,
 * which pg reads from the URL.
 */
export function getPool(): pg.Pool | null {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return null;
  if (!pool) {
    pool = new pg.Pool({ connectionString, max: 3, idleTimeoutMillis: 10_000, connectionTimeoutMillis: 5_000 });
    // An idle client can drop (for example when Neon scales to zero). Log it without details.
    pool.on("error", () => logEvent("db_pool_error"));
  }
  return pool;
}

export interface MatchRunRow {
  id: string;
  score: number;
  requirementCount: number;
  ungroundedCount: number;
  latencyMs: number;
  model: string;
}

export async function insertMatchRun(db: Queryable, row: MatchRunRow): Promise<void> {
  await db.query(
    `INSERT INTO match_runs (id, score, requirement_count, ungrounded_count, latency_ms, model)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [row.id, row.score, row.requirementCount, row.ungroundedCount, row.latencyMs, row.model],
  );
}

/** Record feedback for a run. Returns false when no run has that id. */
export async function setFeedback(db: Queryable, id: string, helpful: boolean): Promise<boolean> {
  const result = await db.query(`UPDATE match_runs SET helpful = $2, feedback_at = now() WHERE id = $1`, [
    id,
    helpful,
  ]);
  return (result.rowCount ?? 0) > 0;
}

export interface StatsRow {
  total_runs: number;
  with_feedback: number;
  helpful_count: number;
  avg_ungrounded: number | null;
}

/** Turn raw counts into the shares shown in the page footer. */
export function toStats(row: StatsRow): StatsResponse {
  return {
    totalRuns: row.total_runs,
    feedbackShare: row.total_runs > 0 ? row.with_feedback / row.total_runs : null,
    helpfulShare: row.with_feedback > 0 ? row.helpful_count / row.with_feedback : null,
    avgUngrounded: row.total_runs > 0 ? row.avg_ungrounded : null,
  };
}

export async function getStats(db: Queryable): Promise<StatsResponse> {
  const result = await db.query<StatsRow>(
    `SELECT count(*)::int                            AS total_runs,
            count(helpful)::int                      AS with_feedback,
            count(*) FILTER (WHERE helpful)::int     AS helpful_count,
            avg(ungrounded_count)::float8            AS avg_ungrounded
       FROM match_runs`,
  );
  const row = result.rows[0];
  if (!row) throw new Error("stats query returned no row");
  return toStats(row);
}
