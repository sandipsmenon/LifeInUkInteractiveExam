import { shuffle } from "../../src/lib/facts";
import { CAT_NAME, PASS_MARK, PER_TEST, STYLES, TOTAL_TESTS, type Attempt, type Mode, type Question, type Session } from "./model";
import type { Store } from "./store";

export type Status = "new" | "missed" | "learned";

export interface Derived {
  q: Question;
  attempts: Attempt[];
  n: number;
  wrong: number;
  last: Attempt | null;
  /** new = never answered; missed = latest answer was wrong (in the retry pool); learned = latest answer right. */
  status: Status;
}

export function derive(q: Question, attempts: Attempt[]): Derived {
  const sorted = [...attempts].sort((a, b) => a.at.localeCompare(b.at));
  const last = sorted[sorted.length - 1] ?? null;
  return {
    q,
    attempts: sorted,
    n: sorted.length,
    wrong: sorted.filter((a) => !a.ok).length,
    last,
    status: !last ? "new" : last.ok ? "learned" : "missed",
  };
}

export function deriveAll(store: Store): Derived[] {
  return store.allQuestions().map((q) => derive(q, store.attemptsOf(q.id)));
}

export function ref(q: Pick<Question, "exam" | "qnum" | "pos">) {
  return q.exam ? `Test ${q.exam}${q.qnum ? ` · Q${q.qnum}` : ""}` : `Unassigned${q.pos ? ` · #${q.pos}` : ""}`;
}
export function answerOf(q: Pick<Question, "options" | "correctKeys">) {
  return q.options.filter((o) => q.correctKeys.includes(o.key)).map((o) => o.text).join("; ");
}
export const catSlugs = (q: Question) => q.cats.map((c) => c.slug);
export const stylesOf = (q: Question) => STYLES.filter((s) => s.match(q)).map((s) => s.key);

export interface StartConfig {
  mode: Mode;
  test?: number;
  style?: string;
  topic?: string;
  count?: number | "all";
  onlyIds?: string[];
}

/** Picks the questions for a session. Throws a readable message when nothing qualifies. */
export function selectQuestions(all: Derived[], c: StartConfig): string[] {
  if (!all.length) throw new Error("There are no questions yet.");
  const limit = (ds: Derived[]) => (c.count === "all" || c.count === undefined ? ds : ds.slice(0, c.count));
  let picked: Derived[] = [];
  if (c.onlyIds) {
    const set = new Set(c.onlyIds);
    picked = all.filter((d) => set.has(d.q.id));
  } else if (c.mode === "test") {
    picked = all.filter((d) => d.q.exam === c.test).sort((a, b) => (a.q.qnum ?? 99) - (b.q.qnum ?? 99) || a.q.seq - b.q.seq);
  } else if (c.mode === "retry") {
    // Most recently missed first, so fresh mistakes are fixed while they are fresh.
    picked = limit(all.filter((d) => d.status === "missed").sort((a, b) => b.last!.at.localeCompare(a.last!.at)));
  } else if (c.mode === "style") {
    const style = STYLES.find((s) => s.key === c.style);
    picked = limit(shuffle(all.filter((d) => style?.match(d.q))));
  } else if (c.mode === "topic") {
    picked = limit(shuffle(all.filter((d) => catSlugs(d.q).includes(c.topic ?? ""))));
  } else {
    // Mixed: unanswered and missed questions first, then the rest, all shuffled.
    const first = shuffle(all.filter((d) => d.status !== "learned"));
    const rest = shuffle(all.filter((d) => d.status === "learned"));
    picked = limit([...first, ...rest]);
  }
  if (!picked.length) {
    throw new Error(c.mode === "retry" ? "No mistakes to retry. Take a test first, or everything you missed is fixed." : "No questions match.");
  }
  return picked.map((d) => d.q.id);
}

/** The latest answer per question within one session. */
export function sessionAnswers(store: Store, s: Session) {
  const out: Record<string, Attempt> = {};
  for (const qid of s.qids) {
    const mine = store.attemptsOf(qid).filter((a) => a.sid === s.id);
    if (mine.length) out[qid] = mine[mine.length - 1];
  }
  return out;
}

export interface TestSummary {
  test: number;
  questions: number;
  attempts: { id: string; at: string; score: number; total: number; passed: boolean }[];
  best: number | null;
  last: { score: number; total: number; passed: boolean } | null;
  inProgress: Session | null;
}

/** One entry per test slot 1..40, with this person's results. */
export function testSummaries(store: Store, all: Derived[]): TestSummary[] {
  const counts = new Map<number, number>();
  for (const d of all) if (d.q.exam) counts.set(d.q.exam, (counts.get(d.q.exam) ?? 0) + 1);
  const sessions = [...store.sessions.values()].filter((s) => s.mode === "test" && s.test).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const max = Math.max(TOTAL_TESTS, ...counts.keys());
  return Array.from({ length: max }, (_, i) => {
    const test = i + 1;
    const mine = sessions.filter((s) => s.test === test);
    const done = mine
      .filter((s) => s.finishedAt)
      .map((s) => {
        const ans = sessionAnswers(store, s);
        const score = Object.values(ans).filter((a) => a.ok).length;
        const total = s.qids.length;
        return { id: s.id, at: s.startedAt, score, total, passed: score >= Math.ceil((total * PASS_MARK) / PER_TEST) };
      });
    const open = mine.filter((s) => !s.finishedAt).pop() ?? null;
    return {
      test,
      questions: counts.get(test) ?? 0,
      attempts: done,
      best: done.length ? Math.max(...done.map((d) => d.score)) : null,
      last: done.length ? done[done.length - 1] : null,
      inProgress: open,
    };
  });
}

export interface Perf {
  key: string;
  name: string;
  questions: number;
  answered: number;
  attempts: number;
  correct: number;
  accuracy: number | null;
  missed: number;
}

function perf(key: string, name: string, ds: Derived[]): Perf {
  const attempts = ds.reduce((n, d) => n + d.n, 0);
  const correct = ds.reduce((n, d) => n + d.n - d.wrong, 0);
  return {
    key,
    name,
    questions: ds.length,
    answered: ds.filter((d) => d.n > 0).length,
    attempts,
    correct,
    accuracy: attempts ? correct / attempts : null,
    missed: ds.filter((d) => d.status === "missed").length,
  };
}
export function categoryPerf(all: Derived[]): Perf[] {
  return Object.keys(CAT_NAME)
    .map((s) => perf(s, CAT_NAME[s], all.filter((d) => catSlugs(d.q).includes(s))))
    .filter((p) => p.questions > 0);
}
export function stylePerf(all: Derived[]): Perf[] {
  return STYLES.map((s) => perf(s.key, s.name, all.filter((d) => s.match(d.q)))).filter((p) => p.questions > 0);
}
export function topicPerf(all: Derived[]): Perf[] {
  const topics = [...new Set(all.flatMap((d) => d.q.topics))].sort();
  return topics.map((t) => perf(t, t, all.filter((d) => d.q.topics.includes(t))));
}

export function dayKey(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
}
export function dailyActivity(all: Derived[], days: number) {
  const counts = new Map<string, { n: number; correct: number }>();
  for (const d of all)
    for (const a of d.attempts) {
      const k = dayKey(new Date(a.at));
      const c = counts.get(k) ?? { n: 0, correct: 0 };
      c.n++;
      if (a.ok) c.correct++;
      counts.set(k, c);
    }
  return Array.from({ length: days }, (_, i) => {
    const k = dayKey(new Date(Date.now() - (days - 1 - i) * 86_400_000));
    return { day: k, ...(counts.get(k) ?? { n: 0, correct: 0 }) };
  });
}

export const pct = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? "—" : `${Math.round(v * 100)}%`);
const dtf = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" });
export const fmt = (iso: string) => dtf.format(new Date(iso));
