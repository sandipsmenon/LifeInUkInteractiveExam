import { describe, expect, it } from "vitest";
import { applyAttempt, difficultyOf, initialState, revisionPriority } from "@/lib/srs";

const DAY = 86_400_000;
const t0 = new Date("2026-01-01T10:00:00Z");
const at = (days: number) => new Date(t0.getTime() + days * DAY);

describe("spaced repetition", () => {
  it("grows the interval 1 → 3 → 7.5 days and reaches mastered after three on-time recalls", () => {
    let s = applyAttempt(initialState(), { isCorrect: true, at: t0 });
    expect(s).toMatchObject({ intervalDays: 1, correctStreak: 1, status: "learning" });
    s = applyAttempt(s, { isCorrect: true, at: at(1) });
    expect(s).toMatchObject({ intervalDays: 3, correctStreak: 2 });
    s = applyAttempt(s, { isCorrect: true, at: at(4) });
    expect(s.intervalDays).toBe(7.5);
    expect(s.status).toBe("mastered");
  });

  it("resets on a wrong answer and makes it due again within minutes", () => {
    let s = applyAttempt(initialState(), { isCorrect: true, at: t0 });
    s = applyAttempt(s, { isCorrect: false, at: at(1) });
    expect(s).toMatchObject({ correctStreak: 0, intervalDays: 0, lapses: 1, status: "needs_revision" });
    expect(s.dueAt!.getTime() - at(1).getTime()).toBe(10 * 60_000);
    expect(s.ease).toBeCloseTo(2.3);
  });

  it("does not let rapid repeats in one sitting fake mastery", () => {
    let s = initialState();
    for (let i = 0; i < 5; i++) s = applyAttempt(s, { isCorrect: true, at: new Date(t0.getTime() + i * 60_000) });
    expect(s.correctStreak).toBe(1);
    expect(s.status).toBe("learning");
  });

  it("treats a lucky guess as barely known", () => {
    const s = applyAttempt(applyAttempt(initialState(), { isCorrect: true, at: t0 }), { isCorrect: true, confidence: 1, at: at(1) });
    expect(s.intervalDays).toBe(1);
    expect(s.ease).toBeLessThan(2.5);
  });

  it("prioritises wrong, forgotten and mock-incorrect questions, and explains why", () => {
    const now = at(10);
    const wrong = applyAttempt(applyAttempt(initialState(), { isCorrect: false, at: at(1) }), { isCorrect: false, at: at(2) });
    const strong = [0, 1, 4].reduce((s, d) => applyAttempt(s, { isCorrect: true, at: at(d) }), initialState());
    const pWrong = revisionPriority({ state: wrong, sourceResult: "incorrect", attempts: 2, wrong: 2, now });
    const pNewMockWrong = revisionPriority({ state: null, sourceResult: "incorrect", attempts: 0, wrong: 0, now });
    const pNewMockRight = revisionPriority({ state: null, sourceResult: "correct", attempts: 0, wrong: 0, now });
    const pStrong = revisionPriority({ state: strong, sourceResult: "correct", attempts: 3, wrong: 0, now });
    expect(pWrong.score).toBeGreaterThan(pNewMockWrong.score);
    expect(pNewMockWrong.score).toBeGreaterThan(pNewMockRight.score);
    expect(pNewMockRight.score).toBeGreaterThan(pStrong.score);
    expect(pWrong.reasons).toContain("You answered it wrong last time");
    expect(pWrong.reasons).toContain("Forgotten 2 times");
  });

  it("derives a personal difficulty", () => {
    expect(difficultyOf(0, 0, null)).toBe("unrated");
    expect(difficultyOf(0, 0, "incorrect")).toBe("hard");
    expect(difficultyOf(4, 0, "incorrect")).toBe("easy");
    expect(difficultyOf(3, 1, null)).toBe("medium");
  });
});
