// Applies pending SQL migrations from ./migrations. Usage: npm run db:migrate
import { createPool, runMigrations } from "../src/lib/server/migrator";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.log("DATABASE_URL is not set; skipping migrations.");
    return;
  }
  const pool = createPool(url);
  try {
    const applied = await runMigrations(pool, (m) => console.log(m));
    console.log(applied.length ? `Applied ${applied.length} migration(s).` : "Database schema is up to date.");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
