import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { exportAll, restoreBackup } from "@/lib/server/backup";
import { query } from "@/lib/server/db";
import { commitImport, previewImport, type ImportPreview } from "@/lib/server/importer";
import { getSession, recordAttempt, startSession } from "@/lib/server/practice";
import { assignExam, getQuestion, listQuestions, updateQuestion } from "@/lib/server/questions";
import { dashboardStats, progressStats } from "@/lib/server/stats";
import { resetDatabase } from "./support/db";

const FILE = "LifeInUk-mock-1-3.md";
const bytes = new Uint8Array(readFileSync(`data/initial/${FILE}`));

function commitAll(p: ImportPreview, extra: { allowSameFile?: boolean } = {}) {
  return commitImport({
    filename: p.filename,
    format: p.format,
    fileHash: p.fileHash,
    interpretation: {},
    allowSameFile: extra.allowSameFile ?? false,
    records: p.records.map((r) => ({ ...r, approved: true, isImportant: r.promptHighlighted })),
  });
}

describe("database workflow with the real dataset", () => {
  beforeAll(async () => {
    await resetDatabase();
  });

  it("imports the initial dataset with every question/answer pair intact", async () => {
    const preview = await previewImport(FILE, bytes);
    expect(preview.summary).toMatchObject({ total: 75, new: 75, duplicates: 0, withErrors: 0 });
    const report = await commitAll(preview);
    expect(report).toMatchObject({ imported: 75, duplicates: 0, skipped: 0 });
    const rows = await query("SELECT prompt, options, correct_keys FROM questions");
    expect(rows).toHaveLength(75);
    const scot = rows.find((r) => r.prompt.startsWith("How many members does the Scottish"))!;
    expect(scot.options.find((o: { key: string }) => o.key === scot.correct_keys[0]).text).toBe("129");
  });

  it("does not duplicate anything when the same document is uploaded again", async () => {
    const preview = await previewImport(FILE, bytes);
    expect(preview.previousImport).not.toBeNull();
    expect(preview.summary.duplicates).toBe(75);
    await expect(commitAll(preview)).rejects.toThrow(/already been imported/);
    const forced = await commitAll(preview, { allowSameFile: true });
    expect(forced).toMatchObject({ imported: 0, duplicates: 75 });
    expect((await query("SELECT count(*)::int AS n FROM questions"))[0].n).toBe(75);
  });

  it("filters by category and search", async () => {
    const dates = await listQuestions({ category: "dates" });
    expect(dates.total).toBeGreaterThan(10);
    expect(dates.rows.every((r) => r.categories.some((c) => c.slug === "dates"))).toBe(true);
    const roses = await listQuestions({ q: "Wars of the Roses" });
    expect(roses.rows.map((r) => r.prompt)).toEqual(
      expect.arrayContaining(["When did the Wars of the Roses start?", "When did the Wars of the Roses end?"]),
    );
    const mockWrong = await listQuestions({ mark: "mock_incorrect" });
    expect(mockWrong.total).toBe(42);
  });

  it("assigns mock exam numbers in document order", async () => {
    const all = await query<{ id: string }>("SELECT id FROM questions ORDER BY source_position LIMIT 25");
    await assignExam({ ids: all.map((r) => r.id), mockExamNumber: 1, renumber: true });
    const exam1 = await listQuestions({ exam: "1" });
    expect(exam1.total).toBe(25);
    expect(exam1.rows[0]).toMatchObject({ questionNumber: 1, sourcePosition: 1 });
    expect(exam1.rows[24]).toMatchObject({ questionNumber: 25, sourcePosition: 25 });
  });

  it("records correct and incorrect answers and updates progress", async () => {
    const q = (await query("SELECT id, correct_keys, options FROM questions WHERE prompt LIKE 'When did the Wars of the Roses start%'"))[0];
    const wrongKey = q.options.find((o: { key: string }) => !q.correct_keys.includes(o.key)).key;
    const session = await startSession({ mode: "quick", count: 75 });
    const fb1 = await recordAttempt({ sessionId: session.id, questionId: q.id, mode: "quick", selectedKeys: [wrongKey] });
    expect(fb1).toMatchObject({ isCorrect: false, status: "needs_revision", correctKeys: q.correct_keys });
    const fb2 = await recordAttempt({ sessionId: session.id, questionId: q.id, mode: "quick", selectedKeys: q.correct_keys, confidence: 3 });
    expect(fb2).toMatchObject({ isCorrect: true, status: "learning", intervalDays: 1 });

    const detail = (await getQuestion(q.id))!;
    expect(detail.attempts).toBe(2);
    expect(detail.wrong).toBe(1);
    expect(detail.review).toMatchObject({ lapses: 1, correctStreak: 1 });

    const stats = await dashboardStats();
    expect(stats.totals).toMatchObject({ attempts: 2, correct: 1, incorrect: 1, questions: 75 });
    expect(stats.totals.accuracy).toBe(0.5);
    const s = (await getSession(session.id))!;
    expect(s.answered[q.id].isCorrect).toBe(true);
  });

  it("weak-area revision puts repeatedly-missed questions first and explains why", async () => {
    const [a, b] = await query("SELECT id, correct_keys, options FROM questions WHERE source_result = 'correct' ORDER BY source_position LIMIT 2");
    for (let i = 0; i < 3; i++) {
      const wrong = a.options.find((o: { key: string }) => !a.correct_keys.includes(o.key)).key;
      await recordAttempt({ questionId: a.id, mode: "quick", selectedKeys: [wrong] });
    }
    await recordAttempt({ questionId: b.id, mode: "quick", selectedKeys: b.correct_keys });
    const session = await startSession({ mode: "weak", count: 10 });
    const data = (await getSession(session.id))!;
    expect(data.questions[0].id).toBe(a.id);
    expect(data.questions[0].reasons).toEqual(expect.arrayContaining(["You answered it wrong last time", "Forgotten 3 times"]));
    expect(data.questions.map((x) => x.id)).not.toContain(b.id);
  });

  it("keeps the original import when a question is edited, and regrades past attempts", async () => {
    const q = (await query("SELECT id FROM questions WHERE prompt LIKE 'When did the Wars of the Roses start%'"))[0];
    const before = (await getQuestion(q.id))!;
    await updateQuestion(q.id, {
      prompt: before.prompt + " (edited)",
      options: before.options,
      correctKeys: ["A"],
      explanation: before.explanation,
      mockExamNumber: before.mockExamNumber,
      questionNumber: before.questionNumber,
    });
    const after = (await getQuestion(q.id))!;
    expect(after.edited).toBe(true);
    expect(after.original!.prompt).toBe("When did the Wars of the Roses start?");
    expect(after.original!.correctKeys).toEqual(["B"]);
    // History was [A (wrong), B (right)]; with A now the answer it becomes [right, wrong].
    expect(after.history.map((h) => h.isCorrect)).toEqual([false, true]); // newest first
    expect(after.wrong).toBe(1);
    expect(after.status).toBe("needs_revision");
  });

  it("progress analytics reflect the recorded history", async () => {
    const p = await progressStats();
    expect(p.frequentlyMissed[0].wrong).toBeGreaterThanOrEqual(3);
    expect(p.firstAttempt.attempted).toBeGreaterThan(0);
    expect(p.sessions.length).toBeGreaterThan(0);
  });

  it("exports a backup that restores into an empty database", async () => {
    const backup = JSON.parse(JSON.stringify(await exportAll()));
    const attemptsBefore = (await query("SELECT count(*)::int AS n FROM attempts"))[0].n;
    await resetDatabase();
    const counts = await restoreBackup(backup);
    expect(counts.questions).toBe(75);
    expect((await query("SELECT count(*)::int AS n FROM attempts"))[0].n).toBe(attemptsBefore);
    expect((await query("SELECT count(*)::int AS n FROM question_categories"))[0].n).toBe(backup.data.question_categories.length);
    // Restoring twice changes nothing.
    const again = await restoreBackup(backup);
    expect(again.questions).toBe(0);
  });
});
