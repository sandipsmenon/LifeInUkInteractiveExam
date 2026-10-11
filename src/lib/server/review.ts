import "server-only";
import { applyAttempt, initialState, type Confidence, type ReviewState } from "@/lib/srs";
import type { Queryable } from "./db";

/**
 * The review state is a cache derived from the attempt log: replaying every attempt in order always
 * gives the same schedule, so edits (regrading, overrides, deleted attempts) can never leave it stale.
 */
export async function recomputeReviewState(c: Queryable, questionId: string): Promise<ReviewState> {
  const attempts = await c.query(
    "SELECT is_correct, confidence, created_at FROM attempts WHERE question_id = $1 ORDER BY created_at, id",
    [questionId],
  );
  let state = initialState();
  for (const a of attempts.rows) {
    state = applyAttempt(state, {
      isCorrect: a.is_correct,
      confidence: (a.confidence as Confidence | null) ?? null,
      at: new Date(a.created_at),
    });
  }
  await c.query(
    `INSERT INTO review_states (question_id, ease, interval_days, due_at, reps, lapses, correct_streak, last_result,
       last_confidence, last_reviewed_at, last_correct_at, status, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, now())
     ON CONFLICT (question_id) DO UPDATE SET ease=$2, interval_days=$3, due_at=$4, reps=$5, lapses=$6,
       correct_streak=$7, last_result=$8, last_confidence=$9, last_reviewed_at=$10, last_correct_at=$11,
       status=$12, updated_at=now()`,
    [
      questionId,
      state.ease,
      state.intervalDays,
      state.dueAt,
      state.reps,
      state.lapses,
      state.correctStreak,
      state.lastResult,
      state.lastConfidence,
      state.lastReviewedAt,
      state.lastCorrectAt,
      state.status,
    ],
  );
  return state;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToState(r: any | null | undefined): ReviewState | null {
  if (!r) return null;
  return {
    ease: r.ease,
    intervalDays: r.interval_days,
    dueAt: r.due_at ? new Date(r.due_at) : null,
    reps: r.reps,
    lapses: r.lapses,
    correctStreak: r.correct_streak,
    lastResult: r.last_result,
    lastConfidence: r.last_confidence,
    lastReviewedAt: r.last_reviewed_at ? new Date(r.last_reviewed_at) : null,
    lastCorrectAt: r.last_correct_at ? new Date(r.last_correct_at) : null,
    status: r.status,
  };
}
