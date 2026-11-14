import type { Queryable } from "../../netlify/lib/db";

export interface RecordedQuery {
  sql: string;
  params: unknown[];
}

/** A fake database that records every query and returns a canned result. */
export function fakeDb(result: { rows?: unknown[]; rowCount?: number } | Error = { rows: [], rowCount: 1 }) {
  const queries: RecordedQuery[] = [];
  const db = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (result instanceof Error) throw result;
      return { rows: result.rows ?? [], rowCount: result.rowCount ?? 0 };
    },
  } as unknown as Queryable;
  return { db, queries };
}
