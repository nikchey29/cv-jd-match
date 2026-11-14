import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";

/**
 * Apply every .sql file in `dir` that has not been applied yet, in file-name
 * order. Each file runs in its own transaction and is recorded in the
 * schema_migrations table, so running this twice is safe.
 * Returns the names of the files applied in this run.
 */
export async function runMigrations(client: pg.ClientBase, dir: string): Promise<string[]> {
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name       text        PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const files = (await readdir(dir)).filter((name) => name.endsWith(".sql")).sort();
  const done = new Set((await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));

  const applied: string[] = [];
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(path.join(dir, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    applied.push(file);
  }
  return applied;
}
