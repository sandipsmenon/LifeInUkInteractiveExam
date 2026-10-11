import "server-only";
import { z } from "zod";
import { refOf, shuffle } from "@/lib/facts";
import { revisionPriority } from "@/lib/srs";
import { EXAM_FORMAT, type AttemptFeedback, type PracticeMode, type PracticeQuestion } from "@/lib/types";
import { query, queryOne, tx } from "./db";
import { recomputeReviewState, rowToState } from "./review";

export const startSchema = z.object({
  mode: z.enum(["quick", "category", "mock", "weak", "revision", "rapid", "mixed", "exam"]),
  count: z.number().int().min(1).max(200).optional(),
  category: z.string().max(50).optional(),
  categories: z.array(z.string().max(50)).max(20).optional(),
  exam: z.number().int().min(1).max(200).optional(),
  batch: z.string().uuid().optional(),
});
export type StartInput = z.infer<typeof startSchema>;

export class PracticeError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

interface Candidate {
  id: string;
  mock_exam_number: number | null;
  question_number: number | null;
  source_position: number | null;
  source_result: "correct" | "incorrect" | null;
  is_confusing: boolean;
  categories: string[];
  attempts: number;
  wrong: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rs: any;
}

async function loadCandidates(): Promise<Candidate[]> {
  return query<Candidate & { [k: string]: unknown }>(
    `SELECT q.id, q.mock_exam_number, q.question_number, q.source_position, q.source_result, q.is_confusing,
            coalesce(array(SELECT c.slug FROM question_categories qc JOIN categories c ON c.id = qc.category_id
                           WHERE qc.question_id = q.id), '{}') AS categories,
            (SELECT count(*)::int FROM attempts a WHERE a.question_id = q.id) AS attempts,
            (SELECT count(*)::int FROM attempts a WHERE a.question_id = q.id AND NOT a.is_correct) AS wrong,
            to_jsonb(rs.*) AS rs
     FROM questions q LEFT JOIN review_states rs ON rs.question_id = q.id`,
  );
}

function prioritise(cands: Candidate[], now: Date) {
  return cands
    .map((c) => ({
      c,
      p: revisionPriority({
        state: rowToState(c.rs),
        sourceResult: c.source_result,
        attempts: c.attempts,
        wrong: c.wrong,
        isConfusing: c.is_confusing,
        now,
      }),
    }))
    .sort((a, b) => b.p.score - a.p.score);
}

/** Round-robin across groups so mixed sessions alternate topics instead of clumping. */
function interleave<T>(groups: T[][], count: number): T[] {
  const out: T[] = [];
  const seen = new Set<T>();
  const qs = groups.map((g) => shuffle(g));
  while (out.length < count && qs.some((g) => g.length)) {
    for (const g of qs) {
      while (g.length && seen.has(g[0])) g.shift();
      const next = g.shift();
      if (next !== undefined) {
        out.push(next);
        seen.add(next);
      }
      if (out.length >= count) break;
    }
  }
  return out;
}

/** Spreads an exam simulation across categories, favouring a broad mix like the real test. */
function examSelection(cands: Candidate[], n: number): Candidate[] {
  const byCat = new Map<string, Candidate[]>();
  for (const c of cands) {
    const primary = c.categories[0] ?? "uncategorised";
    byCat.set(primary, [...(byCat.get(primary) ?? []), c]);
  }
  return interleave([...byCat.values()], n);
}

export async function startSession(input: StartInput): Promise<{ id: string; count: number }> {
  const now = new Date();
  const cands = await loadCandidates();
  if (!cands.length) throw new PracticeError("Your question bank is empty. Import your questions first.");
  const count = input.count ?? (input.mode === "exam" ? EXAM_FORMAT.questions : input.mode === "rapid" ? 30 : 20);
  let picked: Candidate[] = [];
  const reasons: Record<string, string[]> = {};

  switch (input.mode) {
    case "quick":
      picked = shuffle(cands).slice(0, count);
      break;
    case "category": {
      if (!input.category) throw new PracticeError("Choose a category.");
      picked = shuffle(cands.filter((c) => c.categories.includes(input.category!))).slice(0, count);
      break;
    }
    case "mixed": {
      const cats = input.categories?.length ? input.categories : [...new Set(cands.flatMap((c) => c.categories))];
      picked = interleave(
        cats.map((cat) => cands.filter((c) => c.categories.includes(cat))),
        count,
      );
      break;
    }
    case "mock": {
      const pool = input.batch
        ? (await query<{ id: string }>("SELECT id FROM questions WHERE batch_id = $1", [input.batch])).map((r) => r.id)
        : null;
      if (!input.exam && !pool) throw new PracticeError("Choose a mock exam.");
      picked = cands
        .filter((c) => (pool ? pool.includes(c.id) : c.mock_exam_number === input.exam))
        .sort(
          (a, b) =>
            (a.question_number ?? 9999) - (b.question_number ?? 9999) ||
            (a.source_position ?? 9999) - (b.source_position ?? 9999),
        )
        .slice(0, input.count ?? 200);
      break;
    }
    case "weak": {
      const ranked = prioritise(cands, now).filter((x) => x.p.score > 10 && x.c.rs?.status !== "mastered");
      picked = ranked.slice(0, count).map((x) => {
        reasons[x.c.id] = x.p.reasons;
        return x.c;
      });
      break;
    }
    case "revision": {
      const due = cands
        .filter((c) => c.rs?.reps > 0 && c.rs?.due_at && new Date(c.rs.due_at) <= now)
        .sort((a, b) => +new Date(a.rs.due_at) - +new Date(b.rs.due_at));
      picked = due.slice(0, count);
      for (const c of picked) reasons[c.id] = revisionPriority({
        state: rowToState(c.rs), sourceResult: c.source_result, attempts: c.attempts, wrong: c.wrong, now,
      }).reasons;
      break;
    }
    case "rapid": {
      const factual = cands.filter((c) => c.categories.some((s) => ["dates", "numbers", "people"].includes(s)));
      const ranked = prioritise(factual, now);
      // Half from the weakest facts, half random, so recall stays varied.
      const top = ranked.slice(0, Math.ceil(count / 2)).map((x) => x.c);
      const rest = shuffle(factual.filter((c) => !top.includes(c))).slice(0, count - top.length);
      picked = shuffle([...top, ...rest]);
      break;
    }
    case "exam":
      picked = examSelection(cands, count);
      break;
  }

  if (!picked.length) {
    const msg: Partial<Record<PracticeMode, string>> = {
      revision: "Nothing is due for review right now. Try Weak areas or Quick practice.",
      weak: "No weak areas found yet — practise some questions first, or everything is mastered!",
      mock: "That mock exam has no questions assigned yet.",
      category: "No questions in that category yet.",
    };
    throw new PracticeError(msg[input.mode] ?? "No questions match these settings.");
  }

  const session = await queryOne<{ id: string }>(
    `INSERT INTO practice_sessions (mode, config, question_ids, time_limit_seconds)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [
      input.mode,
      JSON.stringify({ ...input, reasons }),
      picked.map((c) => c.id),
      input.mode === "exam" ? EXAM_FORMAT.minutes * 60 : null,
    ],
  );
  return { id: session!.id, count: picked.length };
}

export interface SessionData {
  id: string;
  mode: PracticeMode;
  config: StartInput & { reasons?: Record<string, string[]> };
  startedAt: string;
  finishedAt: string | null;
  timeLimitSeconds: number | null;
  questions: PracticeQuestion[];
  answered: Record<string, { isCorrect: boolean; selectedKeys: string[] }>;
}

export async function getSession(id: string): Promise<SessionData | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const s = await queryOne("SELECT * FROM practice_sessions WHERE id = $1", [id]);
  if (!s) return null;
  const rows = await query(
    `SELECT q.id, q.prompt, q.question_type, q.options, cardinality(q.correct_keys) AS correct_count, q.memory_aid,
            q.mock_exam_number, q.question_number,
            coalesce(array(SELECT c.name FROM question_categories qc JOIN categories c ON c.id = qc.category_id
                           WHERE qc.question_id = q.id ORDER BY c.sort_order), '{}') AS categories
     FROM questions q WHERE q.id = ANY($1::uuid[])`,
    [s.question_ids],
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const reasons = (s.config?.reasons ?? {}) as Record<string, string[]>;
  const questions: PracticeQuestion[] = (s.question_ids as string[])
    .map((qid) => byId.get(qid))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => ({
      id: r.id,
      prompt: r.prompt,
      questionType: r.question_type,
      options: r.options,
      correctCount: r.correct_count,
      ref: refOf({ mockExamNumber: r.mock_exam_number, questionNumber: r.question_number }),
      categories: r.categories,
      reasons: reasons[r.id],
      memoryAid: r.memory_aid,
    }));
  const attempts = await query(
    "SELECT DISTINCT ON (question_id) question_id, is_correct, selected_keys FROM attempts WHERE session_id = $1 ORDER BY question_id, created_at DESC",
    [id],
  );
  return {
    id: s.id,
    mode: s.mode,
    config: s.config,
    startedAt: new Date(s.started_at).toISOString(),
    finishedAt: s.finished_at ? new Date(s.finished_at).toISOString() : null,
    timeLimitSeconds: s.time_limit_seconds,
    questions,
    answered: Object.fromEntries(
      attempts.map((a) => [a.question_id, { isCorrect: a.is_correct, selectedKeys: a.selected_keys }]),
    ),
  };
}

export const attemptSchema = z
  .object({
    sessionId: z.string().uuid().nullable().optional(),
    questionId: z.string().uuid(),
    mode: z.string().min(1).max(30),
    selectedKeys: z.array(z.string().max(3)).max(10).default([]),
    /** Only for self-marked recall (flashcards, rapid recall, "reveal then mark"). */
    selfMarkedCorrect: z.boolean().optional(),
    confidence: z.union([z.literal(1), z.literal(2), z.literal(3)]).nullable().optional(),
    responseMs: z.number().int().min(0).max(3_600_000).optional(),
  })
  .refine((v) => v.selectedKeys.length > 0 || v.selfMarkedCorrect !== undefined || v.mode === "exam", {
    message: "Select an answer, or mark whether you knew it.",
  });
export type AttemptInput = z.infer<typeof attemptSchema>;

function sameKeys(a: string[], b: string[]) {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

export async function recordAttempt(input: AttemptInput): Promise<AttemptFeedback> {
  return tx(async (c) => {
    const q = (await c.query("SELECT id, correct_keys, explanation, memory_aid FROM questions WHERE id = $1", [input.questionId]))
      .rows[0];
    if (!q) throw new PracticeError("Question not found (it may have been deleted).", 404);
    if (input.sessionId) {
      const s = (await c.query("SELECT finished_at, question_ids FROM practice_sessions WHERE id = $1", [input.sessionId])).rows[0];
      if (!s) throw new PracticeError("Practice session not found.", 404);
      if (!(s.question_ids as string[]).includes(input.questionId)) throw new PracticeError("Question is not part of this session.");
    }
    // Lock the schedule row so concurrent submissions for one question are applied in order.
    await c.query("SELECT 1 FROM review_states WHERE question_id = $1 FOR UPDATE", [input.questionId]);
    const selfMarked = input.selfMarkedCorrect !== undefined;
    const isCorrect = selfMarked ? input.selfMarkedCorrect! : sameKeys(input.selectedKeys, q.correct_keys);
    await c.query(
      `INSERT INTO attempts (question_id, session_id, mode, selected_keys, is_correct, confidence, self_marked, response_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        input.questionId,
        input.sessionId ?? null,
        input.mode,
        input.selectedKeys,
        isCorrect,
        input.confidence ?? null,
        selfMarked,
        input.responseMs ?? null,
      ],
    );
    const state = await recomputeReviewState(c, input.questionId);
    return {
      isCorrect,
      correctKeys: q.correct_keys,
      explanation: q.explanation,
      memoryAid: q.memory_aid,
      status: state.status,
      nextDueAt: state.dueAt?.toISOString() ?? null,
      intervalDays: state.intervalDays,
    };
  });
}

/** Lets the learner correct an auto-mark (e.g. a mis-tap) on their latest attempt. */
export async function overrideLastAttempt(questionId: string, sessionId: string | null, isCorrect: boolean) {
  return tx(async (c) => {
    const last = (
      await c.query(
        `SELECT id FROM attempts WHERE question_id = $1 AND session_id IS NOT DISTINCT FROM $2
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [questionId, sessionId],
      )
    ).rows[0];
    if (!last) throw new PracticeError("No attempt to change.", 404);
    await c.query("UPDATE attempts SET is_correct = $2, self_marked = true WHERE id = $1", [last.id, isCorrect]);
    const state = await recomputeReviewState(c, questionId);
    return { status: state.status, nextDueAt: state.dueAt?.toISOString() ?? null };
  });
}

export async function finishSession(id: string) {
  await query("UPDATE practice_sessions SET finished_at = coalesce(finished_at, now()) WHERE id = $1", [id]);
}

export async function sessionResults(id: string) {
  const rows = await query(
    `SELECT DISTINCT ON (a.question_id) a.question_id, a.is_correct, a.selected_keys, q.prompt, q.options, q.correct_keys,
            q.explanation, q.mock_exam_number, q.question_number
     FROM attempts a JOIN questions q ON q.id = a.question_id
     WHERE a.session_id = $1 ORDER BY a.question_id, a.created_at DESC`,
    [id],
  );
  return rows.map((r) => ({
    questionId: r.question_id as string,
    isCorrect: r.is_correct as boolean,
    selectedKeys: r.selected_keys as string[],
    prompt: r.prompt as string,
    options: r.options as { key: string; text: string }[],
    correctKeys: r.correct_keys as string[],
    explanation: r.explanation as string | null,
    ref: refOf({ mockExamNumber: r.mock_exam_number, questionNumber: r.question_number }),
  }));
}

export async function latestUnfinishedSession() {
  const s = await queryOne(
    `SELECT s.id, s.mode, s.started_at, cardinality(s.question_ids) AS total,
            (SELECT count(DISTINCT question_id)::int FROM attempts a WHERE a.session_id = s.id) AS answered
     FROM practice_sessions s
     WHERE s.finished_at IS NULL AND s.started_at > now() - interval '7 days'
     ORDER BY s.started_at DESC LIMIT 1`,
  );
  if (!s || s.answered >= s.total) return null;
  return { id: s.id as string, mode: s.mode as PracticeMode, total: s.total as number, answered: s.answered as number };
}
