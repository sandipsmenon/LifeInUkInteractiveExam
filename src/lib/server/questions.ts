import "server-only";
import { z } from "zod";
import { categorise, deriveTopics } from "@/lib/categorize";
import { contentHash } from "@/lib/hash";
import type { Category, OriginalSnapshot, QuestionDetail, QuestionSummary } from "@/lib/types";
import { query, queryOne, tx, type Queryable } from "./db";
import { recomputeReviewState } from "./review";

/** Base query: one row per question with categories, schedule state and practice stats. */
export const BASE_SELECT = `
SELECT q.id, q.prompt, q.question_type, q.options, q.correct_keys, q.explanation, q.notes, q.memory_aid,
       q.mock_exam_number, q.question_number, q.source_position, q.source_result, q.batch_id, q.topics,
       q.is_important, q.is_confusing, q.edited_at, q.created_at, q.original,
       coalesce(rs.status, 'new') AS status, rs.due_at, rs.last_reviewed_at,
       s.attempts, s.wrong,
       CASE
         WHEN s.attempts + (q.source_result IS NOT NULL)::int = 0 THEN 'unrated'
         WHEN (s.wrong + (coalesce(q.source_result = 'incorrect', false))::int)::float
              / (s.attempts + (q.source_result IS NOT NULL)::int) >= 0.5 THEN 'hard'
         WHEN (s.wrong + (coalesce(q.source_result = 'incorrect', false))::int)::float
              / (s.attempts + (q.source_result IS NOT NULL)::int) > 0.2 THEN 'medium'
         ELSE 'easy'
       END AS difficulty,
       coalesce((SELECT json_agg(json_build_object('slug', c.slug, 'name', c.name, 'source', qc.source) ORDER BY c.sort_order)
                 FROM question_categories qc JOIN categories c ON c.id = qc.category_id
                 WHERE qc.question_id = q.id), '[]'::json) AS categories,
       (SELECT count(*)::int FROM question_flags f WHERE f.question_id = q.id AND f.resolved_at IS NULL) AS open_flags
FROM questions q
LEFT JOIN review_states rs ON rs.question_id = q.id
LEFT JOIN LATERAL (
  SELECT count(*)::int AS attempts, (count(*) FILTER (WHERE NOT a.is_correct))::int AS wrong
  FROM attempts a WHERE a.question_id = q.id
) s ON true`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toSummary(r: any): QuestionSummary {
  return {
    id: r.id,
    prompt: r.prompt,
    questionType: r.question_type,
    options: r.options,
    correctKeys: r.correct_keys,
    mockExamNumber: r.mock_exam_number,
    questionNumber: r.question_number,
    sourcePosition: r.source_position,
    sourceResult: r.source_result,
    batchId: r.batch_id,
    topics: r.topics ?? [],
    categories: r.categories ?? [],
    isImportant: r.is_important,
    isConfusing: r.is_confusing,
    status: r.status,
    dueAt: r.due_at ? new Date(r.due_at).toISOString() : null,
    attempts: r.attempts ?? 0,
    wrong: r.wrong ?? 0,
    difficulty: r.difficulty,
    openFlags: r.open_flags ?? 0,
    edited: !!r.edited_at,
  };
}

export const questionFiltersSchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.string().max(50).optional(),
  topic: z.string().max(100).optional(),
  exam: z.string().regex(/^(\d{1,3}|none)$/).optional(),
  batch: z.string().uuid().optional(),
  status: z.enum(["new", "learning", "needs_revision", "mastered"]).optional(),
  difficulty: z.enum(["easy", "medium", "hard", "unrated"]).optional(),
  type: z.enum(["single", "multi", "true_false"]).optional(),
  mark: z.enum(["important", "confusing", "flagged", "edited", "mock_incorrect"]).optional(),
  sort: z.enum(["source", "newest", "hardest", "most_attempted", "due", "alpha"]).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});
export type QuestionFilters = z.infer<typeof questionFiltersSchema>;

const SORTS: Record<NonNullable<QuestionFilters["sort"]>, string> = {
  source: "mock_exam_number NULLS LAST, question_number NULLS LAST, source_position NULLS LAST, created_at",
  newest: "created_at DESC, source_position",
  hardest: "(wrong + coalesce(source_result = 'incorrect', false)::int)::float / greatest(attempts + (source_result IS NOT NULL)::int, 1) DESC, wrong DESC",
  most_attempted: "attempts DESC, wrong DESC",
  due: "due_at NULLS LAST",
  alpha: "prompt",
};

export const PAGE_SIZE = 50;

export async function listQuestions(f: QuestionFilters): Promise<{ rows: QuestionSummary[]; total: number }> {
  const where: string[] = [];
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.q) {
    const like = p(`%${f.q.replace(/[%_\\]/g, "\\$&")}%`);
    where.push(`(prompt ILIKE ${like} OR options::text ILIKE ${like} OR coalesce(explanation,'') ILIKE ${like}
      OR coalesce(notes,'') ILIKE ${like} OR coalesce(memory_aid,'') ILIKE ${like} OR array_to_string(topics, ' ') ILIKE ${like})`);
  }
  if (f.category) {
    where.push(`EXISTS (SELECT 1 FROM question_categories qc JOIN categories c ON c.id = qc.category_id
      WHERE qc.question_id = b.id AND c.slug = ${p(f.category)})`);
  }
  if (f.topic) where.push(`${p(f.topic)} = ANY(topics)`);
  if (f.exam === "none") where.push("mock_exam_number IS NULL");
  else if (f.exam) where.push(`mock_exam_number = ${p(Number(f.exam))}`);
  if (f.batch) where.push(`batch_id = ${p(f.batch)}`);
  if (f.status) where.push(`status = ${p(f.status)}`);
  if (f.difficulty) where.push(`difficulty = ${p(f.difficulty)}`);
  if (f.type) where.push(`question_type = ${p(f.type)}`);
  if (f.mark === "important") where.push("is_important");
  if (f.mark === "confusing") where.push("is_confusing");
  if (f.mark === "flagged") where.push("open_flags > 0");
  if (f.mark === "edited") where.push("edited_at IS NOT NULL");
  if (f.mark === "mock_incorrect") where.push("source_result = 'incorrect'");

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const order = SORTS[f.sort ?? "source"];
  const page = f.page ?? 1;
  const rows = await query(
    `SELECT b.*, count(*) OVER () AS total FROM (${BASE_SELECT}) b ${whereSql}
     ORDER BY ${order}, id LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`,
    params,
  );
  return { rows: rows.map(toSummary), total: rows[0] ? Number(rows[0].total) : 0 };
}

export async function getQuestion(id: string): Promise<QuestionDetail | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const r = await queryOne(`SELECT b.* FROM (${BASE_SELECT}) b WHERE b.id = $1`, [id]);
  if (!r) return null;
  const [review, history, flags, batch] = await Promise.all([
    queryOne("SELECT * FROM review_states WHERE question_id = $1", [id]),
    query(
      "SELECT id, is_correct, mode, selected_keys, confidence, created_at FROM attempts WHERE question_id = $1 ORDER BY created_at DESC LIMIT 50",
      [id],
    ),
    query("SELECT id, reason, note, created_at, resolved_at FROM question_flags WHERE question_id = $1 ORDER BY created_at DESC", [id]),
    r.batch_id
      ? queryOne("SELECT id, filename, label, created_at FROM import_batches WHERE id = $1", [r.batch_id])
      : Promise.resolve(null),
  ]);
  return {
    ...toSummary(r),
    explanation: r.explanation,
    notes: r.notes,
    memoryAid: r.memory_aid,
    original: r.original as OriginalSnapshot | null,
    batch: batch
      ? { id: batch.id, filename: batch.filename, label: batch.label, createdAt: new Date(batch.created_at).toISOString() }
      : null,
    review: review
      ? {
          ease: review.ease,
          intervalDays: review.interval_days,
          reps: review.reps,
          lapses: review.lapses,
          correctStreak: review.correct_streak,
          lastReviewedAt: review.last_reviewed_at ? new Date(review.last_reviewed_at).toISOString() : null,
        }
      : null,
    history: history.map((h) => ({
      id: h.id,
      isCorrect: h.is_correct,
      mode: h.mode,
      selectedKeys: h.selected_keys,
      confidence: h.confidence,
      createdAt: new Date(h.created_at).toISOString(),
    })),
    flags: flags.map((f) => ({
      id: f.id,
      reason: f.reason,
      note: f.note,
      createdAt: new Date(f.created_at).toISOString(),
      resolvedAt: f.resolved_at ? new Date(f.resolved_at).toISOString() : null,
    })),
  };
}

export async function listCategories(): Promise<Category[]> {
  const rows = await query(
    `SELECT c.id, c.slug, c.name, c.description, count(qc.question_id)::int AS question_count
     FROM categories c LEFT JOIN question_categories qc ON qc.category_id = c.id
     GROUP BY c.id ORDER BY c.sort_order`,
  );
  return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, description: r.description, questionCount: r.question_count }));
}

export async function listTopics(): Promise<{ topic: string; count: number }[]> {
  const rows = await query(
    "SELECT t AS topic, count(*)::int AS count FROM questions, unnest(topics) t GROUP BY t ORDER BY t",
  );
  return rows.map((r) => ({ topic: r.topic, count: r.count }));
}

export async function listExams(): Promise<{ number: number | null; count: number }[]> {
  const rows = await query(
    "SELECT mock_exam_number AS number, count(*)::int AS count FROM questions GROUP BY 1 ORDER BY 1 NULLS LAST",
  );
  return rows.map((r) => ({ number: r.number, count: r.count }));
}

export async function listBatches() {
  const rows = await query(
    `SELECT b.id, b.filename, b.label, b.source_format, b.stats, b.created_at, b.interpretation,
            (SELECT count(*)::int FROM questions q WHERE q.batch_id = b.id) AS question_count
     FROM import_batches b ORDER BY b.created_at DESC`,
  );
  return rows.map((r) => ({
    id: r.id as string,
    filename: r.filename as string,
    label: r.label as string | null,
    format: r.source_format as string,
    stats: r.stats as Record<string, number>,
    createdAt: new Date(r.created_at).toISOString(),
    questionCount: r.question_count as number,
  }));
}

// ---------- writes ----------

const optionSchema = z.object({ key: z.string().min(1).max(3), text: z.string().trim().min(1).max(500) });

export const questionInputSchema = z
  .object({
    prompt: z.string().trim().min(3).max(1000),
    options: z.array(optionSchema).min(2).max(10),
    correctKeys: z.array(z.string()).min(1),
    explanation: z.string().trim().max(5000).nullable().optional(),
    mockExamNumber: z.number().int().min(1).max(200).nullable().optional(),
    questionNumber: z.number().int().min(1).max(1000).nullable().optional(),
    notes: z.string().trim().max(5000).nullable().optional(),
    memoryAid: z.string().trim().max(2000).nullable().optional(),
    isImportant: z.boolean().optional(),
    isConfusing: z.boolean().optional(),
    categories: z.array(z.string().max(50)).optional(),
    topics: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
  })
  .superRefine((v, ctx) => {
    const keys = new Set(v.options.map((o) => o.key));
    if (keys.size !== v.options.length) ctx.addIssue({ code: "custom", message: "Option keys must be unique." });
    for (const k of v.correctKeys) {
      if (!keys.has(k)) ctx.addIssue({ code: "custom", message: `Correct answer "${k}" is not one of the options.` });
    }
    if (v.correctKeys.length >= v.options.length) {
      ctx.addIssue({ code: "custom", message: "At least one option must be incorrect." });
    }
  });
export type QuestionInput = z.infer<typeof questionInputSchema>;

export function questionTypeOf(options: { text: string }[], correctKeys: string[]) {
  if (options.length === 2 && options.every((o) => /^(true|false)$/i.test(o.text.trim().replace(/[.!]$/, "")))) {
    return "true_false" as const;
  }
  return correctKeys.length > 1 ? ("multi" as const) : ("single" as const);
}

export async function applyAutoCategories(
  client: Queryable,
  questionId: string,
  q: { prompt: string; options: { key: string; text: string }[]; correctKeys: string[]; explanation: string | null },
) {
  const slugs = categorise(q);
  await client.query("DELETE FROM question_categories WHERE question_id = $1 AND source = 'auto'", [questionId]);
  await client.query(
    `INSERT INTO question_categories (question_id, category_id, source)
     SELECT $1, id, 'auto' FROM categories WHERE slug = ANY($2::text[])
     ON CONFLICT DO NOTHING`,
    [questionId, slugs],
  );
}

async function setManualCategories(client: Queryable, questionId: string, slugs: string[]) {
  await client.query("DELETE FROM question_categories WHERE question_id = $1", [questionId]);
  await client.query(
    `INSERT INTO question_categories (question_id, category_id, source)
     SELECT $1, id, 'manual' FROM categories WHERE slug = ANY($2::text[])`,
    [questionId, slugs],
  );
}

export class DuplicateQuestionError extends Error {
  constructor(public existingId: string) {
    super("An identical question (same wording and options) already exists.");
  }
}

export async function createQuestion(input: QuestionInput): Promise<string> {
  const hash = contentHash(input.prompt, input.options);
  return tx(async (c) => {
    const dup = await c.query("SELECT id FROM questions WHERE content_hash = $1", [hash]);
    if (dup.rows[0]) throw new DuplicateQuestionError(dup.rows[0].id);
    if (input.mockExamNumber) await ensureMockExam(c, input.mockExamNumber);
    const explanation = input.explanation ?? null;
    const topics = input.topics ?? deriveTopics({ ...input, explanation });
    const res = await c.query(
      `INSERT INTO questions (prompt, question_type, options, correct_keys, explanation, mock_exam_number, question_number,
         content_hash, topics, notes, memory_aid, is_important, is_confusing, original)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [
        input.prompt,
        questionTypeOf(input.options, input.correctKeys),
        JSON.stringify(input.options),
        input.correctKeys,
        explanation,
        input.mockExamNumber ?? null,
        input.questionNumber ?? null,
        hash,
        topics,
        input.notes ?? null,
        input.memoryAid ?? null,
        input.isImportant ?? false,
        input.isConfusing ?? false,
        JSON.stringify({
          prompt: input.prompt,
          options: input.options,
          correctKeys: input.correctKeys,
          explanation,
          mockExamNumber: input.mockExamNumber ?? null,
          questionNumber: input.questionNumber ?? null,
        } satisfies OriginalSnapshot),
      ],
    );
    const id = res.rows[0].id as string;
    if (input.categories?.length) await setManualCategories(c, id, input.categories);
    else await applyAutoCategories(c, id, { ...input, explanation });
    await c.query("INSERT INTO review_states (question_id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
    return id;
  });
}

export async function ensureMockExam(c: Queryable, n: number) {
  await c.query("INSERT INTO mock_exams (number, title) VALUES ($1::int, 'Mock test ' || $1::text) ON CONFLICT DO NOTHING", [n]);
}

/** Updates a question. The `original` snapshot is never modified, so the imported text stays available. */
export async function updateQuestion(id: string, input: QuestionInput): Promise<void> {
  const hash = contentHash(input.prompt, input.options);
  await tx(async (c) => {
    const current = await c.query("SELECT * FROM questions WHERE id = $1 FOR UPDATE", [id]);
    const cur = current.rows[0];
    if (!cur) throw new Error("Question not found.");
    const dup = await c.query("SELECT id FROM questions WHERE content_hash = $1 AND id <> $2", [hash, id]);
    if (dup.rows[0]) throw new DuplicateQuestionError(dup.rows[0].id);
    if (input.mockExamNumber) await ensureMockExam(c, input.mockExamNumber);
    const contentChanged =
      cur.prompt !== input.prompt ||
      JSON.stringify(cur.options) !== JSON.stringify(input.options) ||
      JSON.stringify(cur.correct_keys) !== JSON.stringify(input.correctKeys) ||
      (cur.explanation ?? null) !== (input.explanation ?? null);
    await c.query(
      `UPDATE questions SET prompt=$2, question_type=$3, options=$4, correct_keys=$5, explanation=$6,
         mock_exam_number=$7, question_number=$8, content_hash=$9, topics=$10, notes=$11, memory_aid=$12,
         is_important=$13, is_confusing=$14, updated_at=now(),
         edited_at = CASE WHEN $15 THEN now() ELSE edited_at END
       WHERE id=$1`,
      [
        id,
        input.prompt,
        questionTypeOf(input.options, input.correctKeys),
        JSON.stringify(input.options),
        input.correctKeys,
        input.explanation ?? null,
        input.mockExamNumber ?? null,
        input.questionNumber ?? null,
        hash,
        input.topics ?? cur.topics,
        input.notes ?? null,
        input.memoryAid ?? null,
        input.isImportant ?? false,
        input.isConfusing ?? false,
        contentChanged,
      ],
    );
    if (input.categories) {
      const currentCats = await c.query(
        "SELECT c.slug FROM question_categories qc JOIN categories c ON c.id = qc.category_id WHERE qc.question_id = $1",
        [id],
      );
      const before = currentCats.rows.map((r) => r.slug).sort().join(",");
      if (before !== [...input.categories].sort().join(",")) await setManualCategories(c, id, input.categories);
    }
    if (contentChanged && JSON.stringify(cur.correct_keys) !== JSON.stringify(input.correctKeys)) {
      // Past attempts were graded against the old answer; regrade them so progress stays accurate.
      await c.query(
        `UPDATE attempts SET is_correct = (
           SELECT array(SELECT unnest(selected_keys) ORDER BY 1) = array(SELECT unnest($2::text[]) ORDER BY 1))
         WHERE question_id = $1 AND NOT self_marked`,
        [id, input.correctKeys],
      );
      await recomputeReviewState(c, id);
    }
  });
}

export const patchSchema = z.object({
  isImportant: z.boolean().optional(),
  isConfusing: z.boolean().optional(),
  notes: z.string().trim().max(5000).nullable().optional(),
  memoryAid: z.string().trim().max(2000).nullable().optional(),
});

export async function patchQuestion(id: string, patch: z.infer<typeof patchSchema>) {
  const sets: string[] = [];
  const params: unknown[] = [id];
  const map = { isImportant: "is_important", isConfusing: "is_confusing", notes: "notes", memoryAid: "memory_aid" } as const;
  for (const [k, col] of Object.entries(map)) {
    const v = patch[k as keyof typeof map];
    if (v !== undefined) {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (!sets.length) return;
  await query(`UPDATE questions SET ${sets.join(", ")}, updated_at = now() WHERE id = $1`, params);
}

export async function deleteQuestion(id: string) {
  await query("DELETE FROM questions WHERE id = $1", [id]);
}

export async function restoreOriginal(id: string) {
  const row = await queryOne<{ original: OriginalSnapshot | null }>("SELECT original FROM questions WHERE id = $1", [id]);
  if (!row?.original) throw new Error("No original snapshot is stored for this question.");
  const o = row.original;
  const current = await getQuestion(id);
  await updateQuestion(id, {
    prompt: o.prompt,
    options: o.options,
    correctKeys: o.correctKeys,
    explanation: o.explanation,
    mockExamNumber: current?.mockExamNumber ?? o.mockExamNumber,
    questionNumber: current?.questionNumber ?? o.questionNumber,
    notes: current?.notes ?? null,
    memoryAid: current?.memoryAid ?? null,
    isImportant: current?.isImportant,
    isConfusing: current?.isConfusing,
  });
  await query("UPDATE questions SET edited_at = NULL WHERE id = $1", [id]);
}

export const assignExamSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(2000),
  mockExamNumber: z.number().int().min(1).max(200).nullable(),
  renumber: z.boolean().default(true),
});

/** Assigns questions to a mock exam; optionally numbers them 1..n in their original document order. */
export async function assignExam(input: z.infer<typeof assignExamSchema>) {
  await tx(async (c) => {
    if (input.mockExamNumber) await ensureMockExam(c, input.mockExamNumber);
    await c.query(
      `UPDATE questions q SET mock_exam_number = $2,
         question_number = CASE WHEN $3 AND $2::int IS NOT NULL THEN o.rn ELSE q.question_number END,
         updated_at = now()
       FROM (SELECT id, row_number() OVER (ORDER BY source_position NULLS LAST, created_at) AS rn
             FROM questions WHERE id = ANY($1::uuid[])) o
       WHERE q.id = o.id`,
      [input.ids, input.mockExamNumber, input.renumber],
    );
  });
}

export const flagSchema = z.object({
  reason: z.enum(["confusing", "possible_error", "duplicate", "other"]),
  note: z.string().trim().max(2000).optional(),
});

export async function addFlag(questionId: string, flag: z.infer<typeof flagSchema>) {
  await query("INSERT INTO question_flags (question_id, reason, note) VALUES ($1, $2, $3)", [
    questionId,
    flag.reason,
    flag.note || null,
  ]);
  if (flag.reason === "confusing") await query("UPDATE questions SET is_confusing = true WHERE id = $1", [questionId]);
}

export async function resolveFlag(flagId: string) {
  await query("UPDATE question_flags SET resolved_at = now() WHERE id = $1", [flagId]);
}
