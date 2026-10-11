import "server-only";
import { z } from "zod";
import { query, tx } from "./db";

/** Tables in dependency order. Everything needed to rebuild the bank and its history. */
const TABLES = [
  "mock_exams",
  "import_batches",
  "questions",
  "question_categories",
  "practice_sessions",
  "attempts",
  "review_states",
  "question_flags",
] as const;

export const BACKUP_VERSION = 1;

export async function exportAll() {
  const data: Record<string, unknown[]> = {};
  for (const t of TABLES) data[t] = await query(`SELECT * FROM ${t}`);
  const categories = await query("SELECT id, slug FROM categories");
  // Category ids are local; store slugs so a backup can be restored into a fresh database.
  const slugById = new Map(categories.map((c) => [c.id, c.slug]));
  data.question_categories = (data.question_categories as { category_id: number }[]).map(({ category_id, ...rest }) => ({
    ...rest,
    category_slug: slugById.get(category_id),
  }));
  return { app: "life-in-uk-revision", version: BACKUP_VERSION, exportedAt: new Date().toISOString(), data };
}

const backupSchema = z.object({
  app: z.literal("life-in-uk-revision"),
  version: z.literal(BACKUP_VERSION),
  data: z.object(Object.fromEntries(TABLES.map((t) => [t, z.array(z.record(z.string(), z.unknown()))])) as Record<
    (typeof TABLES)[number],
    z.ZodArray<z.ZodRecord<z.ZodString, z.ZodUnknown>>
  >),
});

const JSON_COLUMNS = new Set(["options", "original", "interpretation", "stats", "config"]);

/**
 * Merges a backup into the database. Rows that already exist (same primary key) are left untouched,
 * so restoring is safe to repeat and never overwrites newer progress.
 */
export async function restoreBackup(raw: unknown) {
  const backup = backupSchema.parse(raw);
  const counts: Record<string, number> = {};
  await tx(async (c) => {
    const cats = await c.query("SELECT id, slug FROM categories");
    const idBySlug = new Map(cats.rows.map((r) => [r.slug, r.id]));
    for (const table of TABLES) {
      let rows = backup.data[table];
      if (table === "question_categories") {
        rows = rows
          .map(({ category_slug, ...rest }) => ({ ...rest, category_id: idBySlug.get(category_slug as string) }))
          .filter((r) => r.category_id !== undefined);
      }
      let inserted = 0;
      for (const row of rows) {
        const cols = Object.keys(row).filter((k) => /^[a-z_]+$/.test(k));
        const values = cols.map((k) => (JSON_COLUMNS.has(k) && row[k] !== null ? JSON.stringify(row[k]) : row[k]));
        const res = await c.query(
          `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
           ON CONFLICT DO NOTHING`,
          values,
        );
        inserted += res.rowCount ?? 0;
      }
      counts[table] = inserted;
    }
  });
  return counts;
}

function csvCell(v: unknown): string {
  let s = v == null ? "" : Array.isArray(v) ? v.join("; ") : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheets treating text as a formula
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportQuestionsCsv(): Promise<string> {
  const rows = await query(
    `SELECT q.mock_exam_number, q.question_number, q.prompt, q.options, q.correct_keys, q.explanation, q.source_result,
            q.topics, q.notes, q.memory_aid, coalesce(rs.status, 'new') AS status,
            array(SELECT c.name FROM question_categories qc JOIN categories c ON c.id = qc.category_id
                  WHERE qc.question_id = q.id ORDER BY c.sort_order) AS categories
     FROM questions q LEFT JOIN review_states rs ON rs.question_id = q.id
     ORDER BY q.mock_exam_number NULLS LAST, q.question_number NULLS LAST, q.source_position`,
  );
  const header = ["Mock", "Question", "Prompt", "Options", "Correct answer(s)", "Explanation", "Mock result", "Categories", "Topics", "Status", "Notes", "Memory aid"];
  const lines = rows.map((r) => {
    const opts = r.options as { key: string; text: string }[];
    return [
      r.mock_exam_number,
      r.question_number,
      r.prompt,
      opts.map((o) => `${o.key}) ${o.text}`),
      opts.filter((o) => r.correct_keys.includes(o.key)).map((o) => o.text),
      r.explanation,
      r.source_result,
      r.categories,
      r.topics,
      r.status,
      r.notes,
      r.memory_aid,
    ]
      .map(csvCell)
      .join(",");
  });
  return [header.join(","), ...lines].join("\n");
}
