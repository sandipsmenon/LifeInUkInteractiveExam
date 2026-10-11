import "server-only";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { createPool, runMigrations } from "./migrator";

type Queryable = Pick<PoolClient, "query">;

const globalForDb = globalThis as unknown as {
  __lifeukPool?: Pool;
  __lifeukMigrated?: Promise<void>;
};

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("DATABASE_URL is not set. See README.md → 'Database setup'.");
    this.name = "DatabaseNotConfiguredError";
  }
}

export function getPool(): Pool {
  if (!process.env.DATABASE_URL) throw new DatabaseNotConfiguredError();
  if (!globalForDb.__lifeukPool) {
    globalForDb.__lifeukPool = createPool(process.env.DATABASE_URL);
  }
  return globalForDb.__lifeukPool;
}

/** Applies pending migrations once per server instance (guarded by an advisory lock). */
async function ready(): Promise<Pool> {
  const pool = getPool();
  if (!globalForDb.__lifeukMigrated) {
    globalForDb.__lifeukMigrated = runMigrations(pool).then(() => undefined).catch((err) => {
      globalForDb.__lifeukMigrated = undefined;
      throw err;
    });
  }
  await globalForDb.__lifeukMigrated;
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const pool = await ready();
  const res = await pool.query<T>(text, params);
  return res.rows;
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
  const pool = await ready();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export type { Queryable };
