// Usage: npm run migrate   (reads DATABASE_URL from the environment or .env)
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { runMigrations } from "./migrations";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) {
  console.error("DATABASE_URL is not set. Add it to .env or the environment.");
  process.exit(1);
}

const dbDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "db");
const client = new pg.Client({ connectionString });

try {
  await client.connect();
  const applied = await runMigrations(client, dbDir);
  console.info(applied.length > 0 ? `Applied: ${applied.join(", ")}` : "Database is up to date.");
} catch (error) {
  // Print only the error class and Postgres error code: messages can contain connection details.
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown";
  console.error(`Migration failed (${error instanceof Error ? error.name : "error"}, code ${code}).`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
