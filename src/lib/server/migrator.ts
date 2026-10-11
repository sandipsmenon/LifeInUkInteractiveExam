// Shared by the app (lazy, on first query) and scripts/migrate.ts. No "server-only" import so the CLI can use it.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";

const MIGRATION_LOCK_ID = 74_260_001;

export function createPool(connectionString: string): Pool {
  const url = new URL(connectionString);
  const isLocal = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  // sslmode in the URL would override the explicit ssl object below, so it is removed here.
  url.searchParams.delete("sslmode");
  const ca = process.env.DATABASE_CA_CERT?.replace(/\\n/g, "\n");
  return new Pool({
    connectionString: url.toString(),
    max: Number(process.env.DATABASE_POOL_MAX ?? 3),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ssl: isLocal || process.env.DATABASE_SSL === "disable"
      ? undefined
      : ca
        ? { ca, rejectUnauthorized: true }
        : { rejectUnauthorized: false },
  });
}

export function migrationsDir(): string {
  return path.join(process.cwd(), "migrations");
}

export async function runMigrations(pool: Pool, log: (msg: string) => void = () => {}): Promise<string[]> {
  const files = (await readdir(migrationsDir())).filter((f) => f.endsWith(".sql")).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set(
      (await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
    );
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(migrationsDir(), file), "utf8");
      log(`Applying ${file}`);
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
        applied.push(file);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID]).catch(() => {});
    client.release();
  }
  return applied;
}
