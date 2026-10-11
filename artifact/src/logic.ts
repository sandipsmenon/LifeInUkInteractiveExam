import { shuffle } from "../../src/lib/facts";
import { applyAttempt, difficultyOf, initialState, revisionPriority, type Difficulty, type ReviewState } from "../../src/lib/srs";
import { CAT_NAME, EXAM, type Attempt, type Mode, type Question } from "./model";
import type { Store } from "./store";

export interface Derived {
  q: Question;
  attempts: Attempt[];
  n: number;
  wrong: number;
  state: ReviewState;
  difficulty: Difficulty;
  firstCorrect: boolean | null;
}

/** The schedule is replayed from the attempt log, so it can never drift out of sync with history. */
export function derive(q: Question, attempts: Attempt[]): Derived {
  let state = initialState();
  const sorted = [...attempts].sort((a, b) => a.at.localeCompare(b.at));
  for (const a of sorted) state = applyAttempt(state, { isCorrect: a.ok, confidence: a.conf, at: new Date(a.at) });
  const wrong = sorted.filter((a) => !a.ok).length;
  return {
    q,
    attempts: sorted,
    n: sorted.length,
    wrong,
    state,
    difficulty: difficultyOf(sorted.length, wrong, q.sourceResult),
    firstCorrect: sorted[0] ? sorted[0].ok : null,
  };
}

export function deriveAll(store: Store): Derived[] {
  return store.allQuestions().map((q) => derive(q, store.attemptsOf(q.id)));
}

export function ref(q: Pick<Question, "exam" | "qnum" | "pos">) {
  return q.exam ? `Mock ${q.exam}${q.qnum ? ` · Q${q.qnum}` : ""}` : `Unassigned${q.pos ? ` · #${q.pos}` : ""}`;
}
export function answerOf(q: Pick<Question, "options" | "correctKeys">) {
  return q.options.filter((o) => q.correctKeys.includes(o.key)).map((o) => o.text).join("; ");
}
export const catSlugs = (q: Question) => q.cats.map((c) => c.slug);

export function priorityOf(d: Derived, now: Date) {
  return revisionPriority({
    state: d.n ? d.state : null,
    sourceResult: d.q.sourceResult,
    attempts: d.n,
    wrong: d.wrong,
    isConfusing: d.q.confusing,
    now,
  });
}

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

export interface StartConfig {
  mode: Mode;
  count?: number;
  category?: string;
  categories?: string[];
  exam?: number;
  batch?: string;
}

/** Picks the questions for a practice session. Throws a readable message when nothing qualifies. */
export function selectQuestions(all: Derived[], c: StartConfig, now = new Date()) {
  if (!all.length) throw new Error("Your question bank is empty. Import your questions first.");
  const count = c.count ?? (c.mode === "exam" ? EXAM.questions : c.mode === "rapid" ? 30 : 20);
  const reasons: Record<string, string[]> = {};
  let picked: Derived[] = [];
  switch (c.mode) {
    case "quick":
      picked = shuffle(all).slice(0, count);
      break;
    case "category":
      picked = shuffle(all.filter((d) => catSlugs(d.q).includes(c.category ?? ""))).slice(0, count);
      break;
    case "mixed": {
      const cats = c.categories?.length ? c.categories : [...new Set(all.flatMap((d) => catSlugs(d.q)))];
      picked = interleave(cats.map((cat) => all.filter((d) => catSlugs(d.q).includes(cat))), count);
      break;
    }
    case "mock":
      picked = all
        .filter((d) => (c.batch ? d.q.batchId === c.batch : d.q.exam === c.exam))
        .sort((a, b) => (a.q.qnum ?? 9999) - (b.q.qnum ?? 9999) || a.q.seq - b.q.seq);
      break;
    case "weak": {
      const ranked = all
        .map((d) => ({ d, p: priorityOf(d, now) }))
        .filter((x) => x.p.score > 10 && x.d.state.status !== "mastered")
        .sort((a, b) => b.p.score - a.p.score)
        .slice(0, count);
      picked = ranked.map((x) => {
        reasons[x.d.q.id] = x.p.reasons;
        return x.d;
      });
      break;
    }
    case "revision":
      picked = all
        .filter((d) => d.n > 0 && d.state.dueAt && d.state.dueAt <= now)
        .sort((a, b) => +a.state.dueAt! - +b.state.dueAt!)
        .slice(0, count);
      for (const d of picked) reasons[d.q.id] = priorityOf(d, now).reasons;
      break;
    case "rapid": {
      const factual = all.filter((d) => catSlugs(d.q).some((s) => ["dates", "numbers", "people"].includes(s)));
      const ranked = factual.map((d) => ({ d, s: priorityOf(d, now).score })).sort((a, b) => b.s - a.s);
      const top = ranked.slice(0, Math.ceil(count / 2)).map((x) => x.d);
      const rest = shuffle(factual.filter((d) => !top.includes(d))).slice(0, count - top.length);
      picked = shuffle([...top, ...rest]);
      break;
    }
    case "exam": {
      const byCat = new Map<string, Derived[]>();
      for (const d of all) {
        const k = d.q.cats[0]?.slug ?? "uncategorised";
        byCat.set(k, [...(byCat.get(k) ?? []), d]);
      }
      picked = interleave([...byCat.values()], count);
      break;
    }
  }
  if (!picked.length) {
    const msg: Partial<Record<Mode, string>> = {
      revision: "Nothing is due for review right now. Try Weak areas or Quick practice.",
      weak: "No weak areas found — practise some questions first, or everything is mastered.",
      mock: "That mock exam has no questions assigned yet.",
      category: "No questions in that category yet.",
    };
    throw new Error(msg[c.mode] ?? "No questions match these settings.");
  }
  return { ids: picked.map((d) => d.q.id), reasons };
}

// ------------------------------------------------------------------ statistics

export interface Perf {
  key: string;
  name: string;
  questions: number;
  attempts: number;
  correct: number;
  mockAnswered: number;
  mockCorrect: number;
  accuracy: number | null;
  mastered: number;
}

function perf(key: string, name: string, ds: Derived[]): Perf {
  const attempts = ds.reduce((n, d) => n + d.n, 0);
  const correct = ds.reduce((n, d) => n + d.n - d.wrong, 0);
  const mockAnswered = ds.filter((d) => d.q.sourceResult).length;
  const mockCorrect = ds.filter((d) => d.q.sourceResult === "correct").length;
  const total = attempts + mockAnswered;
  return {
    key,
    name,
    questions: ds.length,
    attempts,
    correct,
    mockAnswered,
    mockCorrect,
    accuracy: total ? (correct + mockCorrect) / total : null,
    mastered: ds.filter((d) => d.state.status === "mastered").length,
  };
}

export function categoryPerf(all: Derived[]): Perf[] {
  const slugs = Object.keys(CAT_NAME);
  return slugs
    .map((s) => perf(s, CAT_NAME[s], all.filter((d) => catSlugs(d.q).includes(s))))
    .filter((p) => p.questions > 0);
}
export function topicPerf(all: Derived[]): Perf[] {
  const topics = [...new Set(all.flatMap((d) => d.q.topics))].sort();
  return topics.map((t) => perf(t, t, all.filter((d) => d.q.topics.includes(t))));
}
export function examPerf(all: Derived[]): Perf[] {
  const exams = [...new Set(all.map((d) => d.q.exam))].sort((a, b) => (a ?? 9999) - (b ?? 9999));
  return exams.map((e) => perf(String(e ?? "none"), e ? `Mock test ${e}` : "Not assigned to a mock exam", all.filter((d) => d.q.exam === e)));
}

export function dayKey(d: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
}
export function dailyActivity(all: Derived[], days: number) {
  const out: { day: string; n: number; correct: number }[] = [];
  const counts = new Map<string, { n: number; correct: number }>();
  for (const d of all)
    for (const a of d.attempts) {
      const k = dayKey(new Date(a.at));
      const c = counts.get(k) ?? { n: 0, correct: 0 };
      c.n++;
      if (a.ok) c.correct++;
      counts.set(k, c);
    }
  for (let i = days - 1; i >= 0; i--) {
    const k = dayKey(new Date(Date.now() - i * 86_400_000));
    out.push({ day: k, ...(counts.get(k) ?? { n: 0, correct: 0 }) });
  }
  return out;
}

/** Of attempts on questions previously answered correctly, how many were still right (by week). */
export function retention(all: Derived[]) {
  const weeks = new Map<string, { n: number; kept: number }>();
  for (const d of all)
    for (let i = 1; i < d.attempts.length; i++) {
      if (!d.attempts[i - 1].ok) continue;
      const dt = new Date(d.attempts[i].at);
      const monday = new Date(dt);
      monday.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
      const k = monday.toISOString().slice(0, 10);
      const w = weeks.get(k) ?? { n: 0, kept: 0 };
      w.n++;
      if (d.attempts[i].ok) w.kept++;
      weeks.set(k, w);
    }
  return [...weeks.entries()].sort().map(([week, v]) => ({ week, ...v }));
}

export interface SessionSummary {
  id: string;
  mode: Mode;
  startedAt: string;
  finished: boolean;
  total: number;
  answered: number;
  correct: number;
}

export function sessionSummaries(store: Store): SessionSummary[] {
  const bySession = new Map<string, Map<string, Attempt>>();
  for (const [qid, p] of store.progress)
    for (const a of p.attempts) {
      if (!a.sid) continue;
      const m = bySession.get(a.sid) ?? new Map();
      const prev = m.get(qid);
      if (!prev || prev.at < a.at) m.set(qid, a);
      bySession.set(a.sid, m);
    }
  return [...store.sessions.values()]
    .map((s) => {
      const latest = [...(bySession.get(s.id)?.values() ?? [])];
      return {
        id: s.id,
        mode: s.mode,
        startedAt: s.startedAt,
        finished: !!s.finishedAt,
        total: s.qids.length,
        answered: latest.length,
        correct: latest.filter((a) => a.ok).length,
      };
    })
    .filter((s) => s.answered > 0 || !s.finished)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export const pct = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? "—" : `${Math.round(v * 100)}%`);
const dtf = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/London" });
export const fmt = (iso: string) => dtf.format(new Date(iso));
