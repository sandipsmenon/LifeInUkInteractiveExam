/**
 * A deliberately simple, explainable spaced-repetition scheduler (a lightly modified SM-2).
 *
 *  - Wrong answer      -> streak resets, interval resets, due again in 10 minutes, "ease" drops.
 *  - Correct answer    -> next gap grows: 1 day, 3 days, then previous gap × ease (≈2.5).
 *  - Confidence        -> a lucky guess (1) is treated as barely known (due tomorrow, ease drops);
 *                         "unsure" (2) shortens the gap by 30%; "sure" (3) nudges ease up.
 *  - Early re-answers  -> answering correctly well before the due date is recorded, but does not
 *                         grow the gap (so repeating a question in one sitting can't fake mastery).
 *  - Mastered          -> 3+ correct in a row, a gap of 7+ days and the last answer was not a guess.
 */

export type ReviewStatus = "new" | "learning" | "needs_revision" | "mastered";
export type Confidence = 1 | 2 | 3;

export interface ReviewState {
  ease: number;
  intervalDays: number;
  dueAt: Date | null;
  reps: number;
  lapses: number;
  correctStreak: number;
  lastResult: boolean | null;
  lastConfidence: Confidence | null;
  lastReviewedAt: Date | null;
  lastCorrectAt: Date | null;
  status: ReviewStatus;
}

const DAY = 86_400_000;
const MIN_EASE = 1.3;
const MAX_EASE = 3.0;
export const MASTERED_STREAK = 3;
export const MASTERED_INTERVAL_DAYS = 7;

export function initialState(): ReviewState {
  return {
    ease: 2.5,
    intervalDays: 0,
    dueAt: null,
    reps: 0,
    lapses: 0,
    correctStreak: 0,
    lastResult: null,
    lastConfidence: null,
    lastReviewedAt: null,
    lastCorrectAt: null,
    status: "new",
  };
}

export function statusOf(s: Omit<ReviewState, "status">): ReviewStatus {
  if (s.reps === 0) return "new";
  if (s.lastResult === false) return "needs_revision";
  if (s.correctStreak >= MASTERED_STREAK && s.intervalDays >= MASTERED_INTERVAL_DAYS && s.lastConfidence !== 1) {
    return "mastered";
  }
  return "learning";
}

export function applyAttempt(
  prev: ReviewState,
  attempt: { isCorrect: boolean; confidence?: Confidence | null; at: Date },
): ReviewState {
  const { isCorrect, at } = attempt;
  const confidence = attempt.confidence ?? null;
  const next: Omit<ReviewState, "status"> = {
    ...prev,
    reps: prev.reps + 1,
    lastResult: isCorrect,
    lastConfidence: confidence,
    lastReviewedAt: at,
  };

  if (!isCorrect) {
    next.lapses = prev.lapses + 1;
    next.correctStreak = 0;
    next.ease = Math.max(MIN_EASE, prev.ease - 0.2);
    next.intervalDays = 0;
    next.dueAt = new Date(at.getTime() + 10 * 60_000);
    return { ...next, status: statusOf(next) };
  }

  next.lastCorrectAt = at;
  const early =
    prev.dueAt !== null &&
    prev.correctStreak > 0 &&
    prev.intervalDays > 0 &&
    at.getTime() < prev.dueAt.getTime() - prev.intervalDays * DAY * 0.5;
  if (early) {
    // Keep the existing schedule; a lucky guess still pulls the due date forward.
    if (confidence === 1) next.dueAt = new Date(Math.min(prev.dueAt!.getTime(), at.getTime() + DAY));
    return { ...next, status: statusOf(next) };
  }

  const streak = prev.correctStreak + 1;
  let interval = streak === 1 ? 1 : streak === 2 ? 3 : Math.max(prev.intervalDays, 1) * prev.ease;
  let ease = prev.ease;
  if (confidence === 1) {
    interval = Math.min(interval, 1);
    ease -= 0.15;
  } else if (confidence === 2) {
    interval *= 0.7;
  } else if (confidence === 3) {
    ease += 0.05;
  }
  next.correctStreak = streak;
  next.ease = Math.min(MAX_EASE, Math.max(MIN_EASE, ease));
  next.intervalDays = Math.round(interval * 10) / 10;
  next.dueAt = new Date(at.getTime() + next.intervalDays * DAY);
  return { ...next, status: statusOf(next) };
}

export interface PriorityInput {
  state: ReviewState | null;
  sourceResult: "correct" | "incorrect" | null;
  attempts: number;
  wrong: number;
  isConfusing?: boolean;
  now: Date;
}

export interface Priority {
  score: number;
  reasons: string[];
}

/** Ranks how urgently a question needs revision, with human-readable reasons. */
export function revisionPriority({ state, sourceResult, attempts, wrong, isConfusing, now }: PriorityInput): Priority {
  let score = 0;
  const reasons: string[] = [];
  const s = state ?? initialState();

  if (s.lastResult === false) {
    score += 40;
    reasons.push("You answered it wrong last time");
  }
  if (s.lapses > 0) {
    score += Math.min(45, s.lapses * 15);
    reasons.push(`Forgotten ${s.lapses} time${s.lapses === 1 ? "" : "s"}`);
  }
  if (attempts > 0 && wrong / attempts >= 0.5 && attempts >= 2) {
    score += 15;
    reasons.push(`Correct only ${attempts - wrong} of ${attempts} attempts`);
  }
  if (sourceResult === "incorrect" && !s.lastCorrectAt) {
    score += 25;
    reasons.push("Marked incorrect in your mock test and not yet answered correctly here");
  }
  if (s.dueAt && s.dueAt <= now && s.reps > 0) {
    const overdueDays = Math.floor((now.getTime() - s.dueAt.getTime()) / DAY);
    score += 10 + Math.min(30, overdueDays * 5);
    reasons.push(overdueDays >= 1 ? `Review overdue by ${overdueDays} day${overdueDays === 1 ? "" : "s"}` : "Due for review");
  }
  if (s.lastConfidence === 1 && s.lastResult) {
    score += 15;
    reasons.push("Last correct answer was a guess");
  } else if (s.lastConfidence === 2 && s.lastResult) {
    score += 5;
    reasons.push("You were unsure last time");
  }
  if (s.lastCorrectAt) {
    const daysSince = (now.getTime() - s.lastCorrectAt.getTime()) / DAY;
    if (daysSince > 14 && s.status !== "mastered") {
      score += 10;
      reasons.push(`Last recalled correctly ${Math.floor(daysSince)} days ago`);
    }
  }
  if (isConfusing) {
    score += 5;
    reasons.push("You marked it as confusing");
  }
  if (s.reps === 0) {
    score += 8;
    if (sourceResult !== "incorrect") reasons.push("Not practised yet");
  }
  if (s.correctStreak > 0) {
    score -= s.correctStreak * 10;
    reasons.push(`Recalled correctly ${s.correctStreak} time${s.correctStreak === 1 ? "" : "s"} in a row`);
  }
  return { score, reasons };
}

export type Difficulty = "easy" | "medium" | "hard" | "unrated";

/** Personal difficulty from your own history; the original mock result counts as one attempt. */
export function difficultyOf(attempts: number, wrong: number, sourceResult: "correct" | "incorrect" | null): Difficulty {
  const total = attempts + (sourceResult ? 1 : 0);
  const misses = wrong + (sourceResult === "incorrect" ? 1 : 0);
  if (total === 0) return "unrated";
  const rate = misses / total;
  return rate >= 0.5 ? "hard" : rate > 0.2 ? "medium" : "easy";
}
