import { Pool } from "pg";

/** Drops and recreates the test schema. Refuses to run against anything but a *_test database. */
export async function resetDatabase() {
  const url = process.env.DATABASE_URL!;
  if (!/_test(\?|$)/.test(new URL(url).pathname + new URL(url).search) && !new URL(url).pathname.endsWith("_test")) {
    throw new Error(`Refusing to reset non-test database: ${url}`);
  }
  const pool = new Pool({ connectionString: url });
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await pool.end();
  const g = globalThis as unknown as { __lifeukMigrated?: unknown };
  g.__lifeukMigrated = undefined;
}
