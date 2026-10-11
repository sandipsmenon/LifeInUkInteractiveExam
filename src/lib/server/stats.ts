import "server-only";
import { MODES, type PracticeMode } from "@/lib/types";
import { query, queryOne } from "./db";

export interface CategoryPerformance {
  slug: string;
  name: string;
  questions: number;
  attempts: number;
  correct: number;
  mockAnswered: number;
  mockCorrect: number;
  /** Combined accuracy: practice attempts plus the original mock-test result for each question. */
  accuracy: number | null;
  mastered: number;
}

export async function categoryPerformance(): Promise<CategoryPerformance[]> {
  const rows = await query(
    `SELECT c.slug, c.name,
            count(DISTINCT q.id)::int AS questions,
            coalesce(sum(s.attempts), 0)::int AS attempts,
            coalesce(sum(s.attempts - s.wrong), 0)::int AS correct,
            count(q.source_result)::int AS mock_answered,
            (count(*) FILTER (WHERE q.source_result = 'correct'))::int AS mock_correct,
            (count(*) FILTER (WHERE rs.status = 'mastered'))::int AS mastered
     FROM categories c
     JOIN question_categories qc ON qc.category_id = c.id
     JOIN questions q ON q.id = qc.question_id
     LEFT JOIN review_states rs ON rs.question_id = q.id
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS attempts, (count(*) FILTER (WHERE NOT a.is_correct))::int AS wrong
       FROM attempts a WHERE a.question_id = q.id) s ON true
     GROUP BY c.id ORDER BY c.sort_order`,
  );
  return rows.map((r) => {
    const total = r.attempts + r.mock_answered;
    return {
      slug: r.slug,
      name: r.name,
      questions: r.questions,
      attempts: r.attempts,
      correct: r.correct,
      mockAnswered: r.mock_answered,
      mockCorrect: r.mock_correct,
      accuracy: total ? (r.correct + r.mock_correct) / total : null,
      mastered: r.mastered,
    };
  });
}

export async function topicPerformance() {
  const rows = await query(
    `SELECT t AS topic, count(DISTINCT q.id)::int AS questions,
            coalesce(sum(s.attempts), 0)::int AS attempts, coalesce(sum(s.attempts - s.wrong), 0)::int AS correct,
            count(q.source_result)::int AS mock_answered,
            (count(*) FILTER (WHERE q.source_result = 'correct'))::int AS mock_correct
     FROM questions q CROSS JOIN LATERAL unnest(q.topics) t
     LEFT JOIN LATERAL (
       SELECT count(*)::int AS attempts, (count(*) FILTER (WHERE NOT a.is_correct))::int AS wrong
       FROM attempts a WHERE a.question_id = q.id) s ON true
     GROUP BY t`,
  );
  return rows
    .map((r) => {
      const total = r.attempts + r.mock_answered;
      return {
        topic: r.topic as string,
        questions: r.questions as number,
        attempts: r.attempts as number,
        accuracy: total ? (r.correct + r.mock_correct) / total : null,
      };
    })
    .filter((t) => t.accuracy !== null);
}

export async function dashboardStats() {
  const totals = await queryOne(
    `SELECT (SELECT count(*)::int FROM questions) AS questions,
            (SELECT count(DISTINCT mock_exam_number)::int FROM questions WHERE mock_exam_number IS NOT NULL) AS exams,
            (SELECT count(*)::int FROM questions WHERE mock_exam_number IS NULL) AS unassigned,
            (SELECT count(*)::int FROM import_batches) AS batches,
            (SELECT count(*)::int FROM attempts) AS attempts,
            (SELECT count(*)::int FROM attempts WHERE is_correct) AS correct,
            (SELECT count(*)::int FROM questions WHERE source_result = 'correct') AS mock_correct,
            (SELECT count(*)::int FROM questions WHERE source_result IS NOT NULL) AS mock_answered,
            (SELECT count(*)::int FROM review_states WHERE reps > 0 AND due_at <= now()) AS due,
            (SELECT count(*)::int FROM question_flags WHERE resolved_at IS NULL) AS open_flags,
            (SELECT count(DISTINCT question_id)::int FROM attempts) AS practised`,
  );
  const statusRows = await query(
    `SELECT coalesce(rs.status, 'new') AS status, count(*)::int AS n
     FROM questions q LEFT JOIN review_states rs ON rs.question_id = q.id GROUP BY 1`,
  );
  const status = { new: 0, learning: 0, needs_revision: 0, mastered: 0 } as Record<string, number>;
  for (const r of statusRows) status[r.status] = r.n;

  const [categories, topics, recent, activity, lastExam] = await Promise.all([
    categoryPerformance(),
    topicPerformance(),
    recentSessions(6),
    query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, coalesce(x.n, 0)::int AS n, coalesce(x.correct, 0)::int AS correct
       FROM generate_series(current_date - 13, current_date, interval '1 day') d
       LEFT JOIN (SELECT created_at::date AS day, count(*) AS n, count(*) FILTER (WHERE is_correct) AS correct
                  FROM attempts WHERE created_at > current_date - 14 GROUP BY 1) x ON x.day = d::date
       ORDER BY d`,
    ),
    queryOne("SELECT started_at FROM practice_sessions WHERE mode = 'exam' AND finished_at IS NOT NULL ORDER BY started_at DESC LIMIT 1"),
  ]);

  const weakestCategories = categories
    .filter((c) => c.accuracy !== null && c.slug !== "uncategorised")
    .sort((a, b) => a.accuracy! - b.accuracy!)
    .slice(0, 4);
  const weakestTopics = topics
    .filter((t) => t.questions >= 2)
    .sort((a, b) => a.accuracy! - b.accuracy!)
    .slice(0, 5);

  const t = totals!;
  const recommendations: { title: string; detail: string; href: string }[] = [];
  if (t.questions === 0) {
    recommendations.push({ title: "Import your questions", detail: "Your question bank is empty.", href: "/import" });
  }
  if (t.due > 0) {
    recommendations.push({
      title: `Review ${t.due} due question${t.due === 1 ? "" : "s"}`,
      detail: "Spaced repetition says these are about to be forgotten.",
      href: "/practice?mode=revision",
    });
  }
  if (status.needs_revision > 0) {
    recommendations.push({
      title: `Fix ${status.needs_revision} question${status.needs_revision === 1 ? "" : "s"} you got wrong`,
      detail: "Weak-areas mode puts your most-missed questions first and explains why.",
      href: "/practice?mode=weak",
    });
  }
  if (weakestCategories[0]) {
    const w = weakestCategories[0];
    recommendations.push({
      title: `Practise ${w.name}`,
      detail: `Your weakest category at ${Math.round(w.accuracy! * 100)}% (practice + mock results).`,
      href: `/practice?mode=category&category=${w.slug}`,
    });
  }
  const unpractised = t.questions - t.practised;
  if (unpractised > 0 && t.questions > 0) {
    recommendations.push({
      title: `Try ${unpractised} question${unpractised === 1 ? "" : "s"} you haven't practised`,
      detail: "Mock-test incorrect answers are prioritised in Weak areas.",
      href: "/practice?mode=quick",
    });
  }
  const daysSinceExam = lastExam ? (Date.now() - new Date(lastExam.started_at).getTime()) / 86_400_000 : Infinity;
  if (t.questions >= 24 && daysSinceExam > 7 && t.attempts >= 50) {
    recommendations.push({
      title: "Take an exam simulation",
      detail: lastExam ? "It's been over a week since your last timed test." : "Check your readiness under real exam timing.",
      href: "/practice?mode=exam",
    });
  }
  if (t.unassigned > 0) {
    recommendations.push({
      title: `Assign ${t.unassigned} question${t.unassigned === 1 ? "" : "s"} to a mock exam`,
      detail: "Your document did not say which mock test each question came from.",
      href: "/questions?exam=none",
    });
  }
  if (t.open_flags > 0) {
    recommendations.push({
      title: `Check ${t.open_flags} flagged question${t.open_flags === 1 ? "" : "s"}`,
      detail: "Possible source errors or confusing questions you flagged.",
      href: "/questions?mark=flagged",
    });
  }

  return {
    totals: {
      questions: t.questions as number,
      exams: t.exams as number,
      unassigned: t.unassigned as number,
      batches: t.batches as number,
      attempts: t.attempts as number,
      correct: t.correct as number,
      incorrect: (t.attempts - t.correct) as number,
      accuracy: t.attempts ? t.correct / t.attempts : null,
      mockCorrect: t.mock_correct as number,
      mockAnswered: t.mock_answered as number,
      due: t.due as number,
      openFlags: t.open_flags as number,
      practised: t.practised as number,
    },
    status,
    weakestCategories,
    weakestTopics,
    recent,
    activity: activity.map((a) => ({ day: a.day as string, n: a.n as number, correct: a.correct as number })),
    recommendations: recommendations.slice(0, 5),
  };
}

export async function recentSessions(limit = 20) {
  const rows = await query(
    `SELECT s.id, s.mode, s.config, s.started_at, s.finished_at, cardinality(s.question_ids) AS total,
            count(DISTINCT a.question_id)::int AS answered,
            (count(DISTINCT a.question_id) FILTER (WHERE a.is_correct))::int AS correct
     FROM practice_sessions s LEFT JOIN attempts a ON a.session_id = s.id
     GROUP BY s.id ORDER BY s.started_at DESC LIMIT $1`,
    [limit],
  );
  return rows
    .filter((r) => r.answered > 0)
    .map((r) => ({
      id: r.id as string,
      mode: r.mode as PracticeMode,
      label: MODES[r.mode as PracticeMode]?.label ?? r.mode,
      startedAt: new Date(r.started_at).toISOString(),
      finished: !!r.finished_at,
      total: r.total as number,
      answered: r.answered as number,
      correct: r.correct as number,
    }));
}

export async function progressStats() {
  const [categories, exams, missed, firstAttempt, daily, retention, sessions] = await Promise.all([
    categoryPerformance(),
    query(
      `SELECT q.mock_exam_number AS exam, count(DISTINCT q.id)::int AS questions,
              coalesce(sum(s.attempts), 0)::int AS attempts, coalesce(sum(s.attempts - s.wrong), 0)::int AS correct,
              (count(*) FILTER (WHERE q.source_result = 'correct'))::int AS mock_correct,
              count(q.source_result)::int AS mock_answered
       FROM questions q
       LEFT JOIN LATERAL (SELECT count(*)::int AS attempts, (count(*) FILTER (WHERE NOT a.is_correct))::int AS wrong
                          FROM attempts a WHERE a.question_id = q.id) s ON true
       GROUP BY 1 ORDER BY 1 NULLS LAST`,
    ),
    query(
      `SELECT q.id, q.prompt, q.mock_exam_number, q.question_number, s.attempts, s.wrong, rs.status, rs.last_result
       FROM questions q
       JOIN LATERAL (SELECT count(*)::int AS attempts, (count(*) FILTER (WHERE NOT a.is_correct))::int AS wrong
                     FROM attempts a WHERE a.question_id = q.id) s ON s.wrong > 0
       LEFT JOIN review_states rs ON rs.question_id = q.id
       ORDER BY s.wrong DESC, s.attempts DESC LIMIT 15`,
    ),
    queryOne(
      `SELECT count(*)::int AS attempted, (count(*) FILTER (WHERE first_attempt_correct))::int AS first_correct
       FROM question_attempt_stats WHERE attempts > 0`,
    ),
    query(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day, coalesce(x.n, 0)::int AS n, coalesce(x.correct, 0)::int AS correct,
              coalesce(x.reviews, 0)::int AS reviews
       FROM generate_series(current_date - 29, current_date, interval '1 day') d
       LEFT JOIN (SELECT created_at::date AS day, count(*) AS n, count(*) FILTER (WHERE is_correct) AS correct,
                         count(*) FILTER (WHERE mode = 'revision') AS reviews
                  FROM attempts WHERE created_at > current_date - 30 GROUP BY 1) x ON x.day = d::date
       ORDER BY d`,
    ),
    // Retention: of attempts on questions you had previously answered correctly, how many were still right?
    query(
      `SELECT to_char(date_trunc('week', created_at), 'YYYY-MM-DD') AS week, count(*)::int AS n,
              (count(*) FILTER (WHERE is_correct))::int AS kept
       FROM (SELECT created_at, is_correct,
                    lag(is_correct) OVER (PARTITION BY question_id ORDER BY created_at) AS prev_correct
             FROM attempts) x
       WHERE prev_correct IS TRUE GROUP BY 1 ORDER BY 1`,
    ),
    recentSessions(30),
  ]);

  const repeatedlyWrong = missed.filter((m) => m.wrong >= 2 && m.last_result === false);
  const chronological = [...sessions].reverse();
  const withChange = chronological.map((s, i) => {
    const prevSame = chronological.slice(0, i).reverse().find((p) => p.mode === s.mode);
    const acc = s.correct / s.answered;
    return { ...s, accuracy: acc, change: prevSame ? acc - prevSame.correct / prevSame.answered : null };
  });

  return {
    categories,
    exams: exams.map((e) => {
      const total = e.attempts + e.mock_answered;
      return {
        exam: e.exam as number | null,
        questions: e.questions as number,
        attempts: e.attempts as number,
        practiceAccuracy: e.attempts ? e.correct / e.attempts : null,
        mockScore: e.mock_answered ? { correct: e.mock_correct as number, total: e.mock_answered as number } : null,
        accuracy: total ? (e.correct + e.mock_correct) / total : null,
      };
    }),
    frequentlyMissed: missed.map((m) => ({
      id: m.id as string,
      prompt: m.prompt as string,
      ref: m.mock_exam_number ? `Mock ${m.mock_exam_number}${m.question_number ? ` · Q${m.question_number}` : ""}` : "Unassigned",
      attempts: m.attempts as number,
      wrong: m.wrong as number,
      status: m.status as string,
    })),
    repeatedlyWrongCount: repeatedlyWrong.length,
    firstAttempt: { attempted: firstAttempt?.attempted ?? 0, firstCorrect: firstAttempt?.first_correct ?? 0 },
    daily: daily.map((d) => ({ day: d.day as string, n: d.n as number, correct: d.correct as number, reviews: d.reviews as number })),
    retention: retention.map((r) => ({ week: r.week as string, n: r.n as number, kept: r.kept as number })),
    sessions: withChange.reverse(),
  };
}
