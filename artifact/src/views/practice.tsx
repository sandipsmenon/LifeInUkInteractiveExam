import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Confidence } from "../../../src/lib/srs";
import { CAT_NAME, CATEGORIES, EXAM, MODES, newId, type Attempt, type Mode, type Question, type Session } from "../model";
import { answerOf, catSlugs, derive, deriveAll, ref, selectQuestions, type StartConfig } from "../logic";
import { FlagButton } from "./bank";
import { PageHeader, StatusPill, useApp } from "../ui";

const ORDER: Mode[] = ["weak", "revision", "quick", "category", "mixed", "mock", "rapid", "exam"];
const COUNTED: Mode[] = ["quick", "category", "mixed", "weak", "revision", "rapid"];

export function PracticeHome({ initial }: { initial: string | null }) {
  const { store, go } = useApp();
  const all = deriveAll(store);
  const [initMode, initArg] = (initial ?? "").split(".");
  const [mode, setMode] = useState<Mode>((ORDER as string[]).includes(initMode) ? (initMode as Mode) : "weak");
  const cats = CATEGORIES.filter((c) => all.some((d) => catSlugs(d.q).includes(c.slug)));
  const [category, setCategory] = useState(initMode === "category" && initArg ? initArg : cats[0]?.slug ?? "");
  const [mixed, setMixed] = useState<string[]>([]);
  const [count, setCount] = useState(20);
  const exams = [...new Set(all.map((d) => d.q.exam).filter((e): e is number => e !== null))].sort((a, b) => a - b);
  const batches = [...store.batches.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const [source, setSource] = useState(exams[0] ? `exam:${exams[0]}` : batches[0] ? `batch:${batches[0].id}` : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const now = new Date();
  const due = all.filter((d) => d.n > 0 && d.state.dueAt && d.state.dueAt <= now).length;
  const unassigned = all.filter((d) => !d.q.exam).length;

  async function start() {
    setError(null);
    const cfg: StartConfig = { mode };
    if (COUNTED.includes(mode)) cfg.count = count;
    if (mode === "category") cfg.category = category;
    if (mode === "mixed" && mixed.length) cfg.categories = mixed;
    if (mode === "mock") {
      const [k, v] = source.split(":");
      if (k === "exam") cfg.exam = Number(v);
      else cfg.batch = v;
    }
    try {
      const { ids, reasons } = selectQuestions(all, cfg);
      const s: Session = {
        id: newId(),
        mode,
        config: cfg as unknown as Record<string, unknown>,
        qids: ids,
        reasons,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        timeLimit: mode === "exam" ? EXAM.minutes * 60 : null,
      };
      setBusy(true);
      await store.putSession(s);
      go("session", s.id);
    } catch (err) {
      setBusy(false);
      setError((err as Error).message);
    }
  }

  return (
    <>
      <PageHeader title="Practice" sub="Pick a mode. Every answer updates your progress and revision schedule." />
      <div className="practice-grid">
        <fieldset className="modes">
          <legend className="sr-only">Practice mode</legend>
          {ORDER.map((m) => (
            <label key={m} className={`mode ${mode === m ? "on" : ""}`}>
              <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} />
              <span>
                <span className="strong">
                  {MODES[m].label}
                  {m === "revision" && <span className="pill ml">{due} due</span>}
                </span>
                <span className="small muted block">{MODES[m].description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="panel sticky-side">
          <h2>{MODES[mode].label}</h2>
          {mode === "category" && (
            <div className="field">
              <label htmlFor="pcat">Category</label>
              <select id="pcat" value={category} onChange={(e) => setCategory(e.target.value)}>
                {cats.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name} ({all.filter((d) => catSlugs(d.q).includes(c.slug)).length})
                  </option>
                ))}
              </select>
            </div>
          )}
          {mode === "mixed" && (
            <fieldset className="field">
              <legend>Categories to mix (none = all)</legend>
              <div className="chips">
                {cats.map((c) => {
                  const on = mixed.includes(c.slug);
                  return (
                    <button key={c.slug} aria-pressed={on} className={`chip ${on ? "on" : ""}`} onClick={() => setMixed(on ? mixed.filter((x) => x !== c.slug) : [...mixed, c.slug])}>
                      {c.name}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          )}
          {mode === "mock" && (
            <div className="field">
              <label htmlFor="psrc">Mock exam or import batch</label>
              <select id="psrc" value={source} onChange={(e) => setSource(e.target.value)}>
                {exams.map((e) => (
                  <option key={e} value={`exam:${e}`}>
                    Mock test {e} ({all.filter((d) => d.q.exam === e).length} questions)
                  </option>
                ))}
                {batches.map((b) => (
                  <option key={b.id} value={`batch:${b.id}`}>
                    Batch: {b.label ?? b.filename}
                  </option>
                ))}
              </select>
              {unassigned > 0 && (
                <p className="tiny muted">
                  {unassigned} questions are not assigned to a mock exam yet.{" "}
                  <button className="linkbtn" onClick={() => go("bank", "exam.none")}>
                    Assign them
                  </button>
                </p>
              )}
            </div>
          )}
          {COUNTED.includes(mode) && (
            <div className="field">
              <label htmlFor="pcount">Number of questions</label>
              <select id="pcount" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                {[10, 20, 30, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </div>
          )}
          {mode === "exam" && <p className="small muted">The official format: 24 questions, 45 minutes, 18 correct (75%) to pass. Answers are marked when you submit.</p>}
          {mode === "weak" && <p className="small muted">Ranked by previous wrong answers, how often you forget, time since your last correct recall, your mock result and confidence.</p>}
          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}
          <button className="btn btn-primary wide" onClick={start} disabled={busy || (mode === "mock" && !source)}>
            {busy ? "Starting…" : "Start"}
          </button>
        </div>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ session

function ordered(q: Question, seed: string) {
  if (q.type === "true_false") return q.options;
  let h = 2166136261;
  for (const c of seed + q.id) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const rand = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
  const a = q.options.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function sameKeys(a: string[], b: string[]) {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join();
}

/** The latest attempt per question within one session. */
function sessionAnswers(store: ReturnType<typeof useApp>["store"], s: Session) {
  const out: Record<string, Attempt> = {};
  for (const qid of s.qids) {
    const mine = store.attemptsOf(qid).filter((a) => a.sid === s.id);
    if (mine.length) out[qid] = mine[mine.length - 1];
  }
  return out;
}

export function SessionView({ id }: { id: string }) {
  const { store, go } = useApp();
  const s = store.sessions.get(id);
  if (!s) {
    return (
      <div className="panel narrow">
        <h1 className="h2">Session not found</h1>
        <button className="btn" onClick={() => go("practice")}>
          Back to practice
        </button>
      </div>
    );
  }
  const qs = s.qids.map((q) => store.questions.get(q)).filter((q): q is Question => !!q);
  if (s.finishedAt) return <Summary session={s} questions={qs} />;
  if (s.mode === "exam") return <ExamRunner session={s} questions={qs} />;
  return <StudyRunner session={s} questions={qs} />;
}

async function finish(store: ReturnType<typeof useApp>["store"], s: Session) {
  await store.putSession({ ...s, finishedAt: new Date().toISOString() });
}

function ProgressBar({ index, total, answered, correct }: { index: number; total: number; answered: number; correct?: number }) {
  return (
    <div className="qprogress">
      <div className="row between tiny muted">
        <span>
          Question {Math.min(index + 1, total)} of {total}
        </span>
        {correct !== undefined && (
          <span className="num">
            {correct}/{answered} correct
          </span>
        )}
      </div>
      <div className="meter-track" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered}>
        <div className="meter-fill" style={{ width: `${(answered / Math.max(total, 1)) * 100}%` }} />
      </div>
    </div>
  );
}

interface Feedback {
  ok: boolean;
  revealed: boolean; // answer shown before self-marking
}

function StudyRunner({ session, questions }: { session: Session; questions: Question[] }) {
  const { store, go } = useApp();
  const answers = sessionAnswers(store, session);
  const firstOpen = questions.findIndex((q) => !answers[q.id]);
  const [index, setIndex] = useState(firstOpen === -1 ? Math.max(questions.length - 1, 0) : firstOpen);
  const [selected, setSelected] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [askConf, setAskConf] = useState(() => {
    try {
      return localStorage.getItem("askConfidence") !== "0";
    } catch {
      return true;
    }
  });
  const [fb, setFb] = useState<Feedback | null>(null);
  const [busy, setBusy] = useState(false);
  const shownAt = useRef(0);
  const rapid = session.mode === "rapid";
  const q = questions[index];
  const opts = useMemo(() => (q ? ordered(q, session.id) : []), [q, session.id]);

  useEffect(() => {
    shownAt.current = Date.now();
  }, [index]);

  const answeredCount = Object.keys(answers).length;
  const correctCount = Object.values(answers).filter((a) => a.ok).length;

  const record = useCallback(
    async (sel: string[], self?: boolean) => {
      if (!q) return;
      const ok = self !== undefined ? self : sameKeys(sel, q.correctKeys);
      const a: Attempt = { at: new Date().toISOString(), ok, sel, conf: askConf ? confidence : null, mode: session.mode, sid: session.id, self: self !== undefined };
      setFb({ ok, revealed: false });
      setBusy(true);
      try {
        await store.addAttempt(q.id, a);
      } finally {
        setBusy(false);
      }
    },
    [q, askConf, confidence, session, store],
  );

  async function override(ok: boolean) {
    const list = store.attemptsOf(q.id).slice();
    for (let i = list.length - 1; i >= 0; i--)
      if (list[i].sid === session.id) {
        list[i] = { ...list[i], ok, self: true };
        break;
      }
    setFb({ ok, revealed: false });
    await store.setAttempts(q.id, list);
  }

  async function next() {
    if (index + 1 >= questions.length) {
      await finish(store, session);
      return;
    }
    setIndex(index + 1);
    setSelected([]);
    setConfidence(null);
    setFb(null);
    window.scrollTo({ top: 0 });
  }

  function toggle(k: string) {
    if (fb) return;
    if (q.type === "multi") setSelected(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);
    else setSelected([k]);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      const n = Number(e.key);
      if (!rapid && !fb && n >= 1 && n <= opts.length) toggle(opts[n - 1].key);
      if (e.key === "Enter" && !busy) {
        if (fb && !fb.revealed) next();
        else if (!fb && selected.length && !rapid) record(selected);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!q) return <p>This session has no questions (they may have been deleted).</p>;
  const reasons = session.reasons?.[q.id];
  const marked = fb && !fb.revealed;
  const d = derive(q, store.attemptsOf(q.id));

  return (
    <div className="runner">
      <div className="row between">
        <h1 className="h2">{MODES[session.mode].label}</h1>
        <button className="linkbtn muted" onClick={() => go("practice")}>
          Exit
        </button>
      </div>
      <ProgressBar index={index} total={questions.length} answered={answeredCount} correct={correctCount} />
      <article className="qcard" aria-live="polite">
        <div className="chips">
          <span className="chip static">{ref(q)}</span>
          {q.cats.slice(0, 3).map((c) => (
            <span key={c.slug} className="chip static">
              {CAT_NAME[c.slug]}
            </span>
          ))}
          {q.type === "multi" && <span className="chip static warn">Choose {q.correctKeys.length}</span>}
        </div>
        {reasons && reasons.length > 0 && (
          <details className="why">
            <summary>Why this question?</summary>
            <ul>
              {reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </details>
        )}
        <h2 className="prompt">{q.prompt}</h2>

        {rapid ? (
          !fb ? (
            <button className="btn btn-primary wide mt" onClick={() => setFb({ ok: false, revealed: true })}>
              Show answer
            </button>
          ) : (
            <div className="answer-box">
              <div className="tiny muted">Answer</div>
              <div className="big">{answerOf(q)}</div>
            </div>
          )
        ) : (
          <ul className="options" role={q.type === "multi" ? "group" : "radiogroup"} aria-label="Answer options">
            {opts.map((o, i) => {
              const sel = selected.includes(o.key);
              const right = q.correctKeys.includes(o.key);
              let cls = sel ? "opt sel" : "opt";
              if (fb) cls = right ? "opt right" : sel ? "opt wrong" : "opt dim";
              return (
                <li key={o.key}>
                  <button role={q.type === "multi" ? "checkbox" : "radio"} aria-checked={sel} disabled={!!fb} className={cls} onClick={() => toggle(o.key)}>
                    <span className="okey">{i + 1}</span>
                    <span className="grow">{o.text}</span>
                    {fb && right && <span className="tag good">Correct answer</span>}
                    {fb && sel && !right && <span className="tag bad">Your answer</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!fb && !rapid && askConf && (
          <fieldset className="conf">
            <legend className="tiny muted">How sure are you? (optional)</legend>
            <div className="row">
              {(
                [
                  [1, "Guessing"],
                  [2, "Unsure"],
                  [3, "Sure"],
                ] as const
              ).map(([v, l]) => (
                <button key={v} aria-pressed={confidence === v} className={`btn btn-sm grow ${confidence === v ? "on" : ""}`} onClick={() => setConfidence(confidence === v ? null : v)}>
                  {l}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {!fb && !rapid && (
          <div className="row wrap mt">
            <button className="btn btn-primary grow" disabled={!selected.length || busy} onClick={() => record(selected)}>
              Check answer
            </button>
            <button className="btn" onClick={() => setFb({ ok: false, revealed: true })}>
              I don’t know, reveal
            </button>
          </div>
        )}

        {fb?.revealed && (
          <div className="mt">
            {!rapid && <p className="small">The answer is: <strong>{answerOf(q)}</strong></p>}
            <p className="small muted">Did you know it?</p>
            <div className="row">
              <button className="btn grow good-outline" disabled={busy} onClick={() => record([], true)}>
                I knew it
              </button>
              <button className="btn grow bad-outline" disabled={busy} onClick={() => record([], false)}>
                I didn’t know
              </button>
            </div>
          </div>
        )}

        {marked && (
          <div className="feedback">
            <div className={`verdict ${fb.ok ? "good" : "bad"}`} role="status">
              {fb.ok ? "Correct" : `Incorrect. The answer is: ${answerOf(q)}`}
            </div>
            {q.explanation && <p className="explain">{q.explanation}</p>}
            {q.aid && (
              <p className="aid">
                <strong>Memory aid:</strong> {q.aid}
              </p>
            )}
            <p className="tiny muted">
              <StatusPill status={d.state.status} />{" "}
              {d.state.intervalDays >= 1
                ? `Next review in ${d.state.intervalDays} day${d.state.intervalDays === 1 ? "" : "s"}`
                : d.state.intervalDays > 0
                  ? `Next review in about ${Math.round(d.state.intervalDays * 24)} hours`
                  : "Back for review in 10 minutes"}{" "}
              ·{" "}
              <button className="linkbtn" onClick={() => override(!fb.ok)}>
                {fb.ok ? "Actually I got this wrong" : "Mark as correct instead"}
              </button>
            </p>
          </div>
        )}

        <div className="qfoot">
          <div className="row">
            <FlagButton q={q} />
            <button className="linkbtn tiny muted" onClick={() => go("q", q.id)}>
              Edit / notes
            </button>
          </div>
          {marked ? (
            <button className="btn btn-primary" onClick={next} autoFocus>
              {index + 1 >= questions.length ? "Finish" : "Next"}
            </button>
          ) : (
            !rapid && (
              <label className="tiny muted row">
                <input
                  type="checkbox"
                  checked={askConf}
                  onChange={(e) => {
                    setAskConf(e.target.checked);
                    try {
                      localStorage.setItem("askConfidence", e.target.checked ? "1" : "0");
                    } catch {
                      /* preference only */
                    }
                  }}
                />
                Ask confidence
              </label>
            )
          )}
        </div>
      </article>
      <p className="tiny muted center hide-sm">Keys: 1–{Math.max(opts.length, 2)} choose · Enter check / next</p>
    </div>
  );
}

function ExamRunner({ session, questions }: { session: Session; questions: Question[] }) {
  const { store, go } = useApp();
  const key = `exam:${session.id}`;
  const [answers, setAnswers] = useState<Record<string, string[]>>(() => {
    try {
      return JSON.parse(sessionStorage.getItem(key) ?? "{}");
    } catch {
      return {};
    }
  });
  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [askSubmit, setAskSubmit] = useState(false);
  const done = useRef(false);
  const deadline = new Date(session.startedAt).getTime() + (session.timeLimit ?? EXAM.minutes * 60) * 1000;
  const remaining = Math.max(0, deadline - now);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const save = (next: Record<string, string[]>) => {
    setAnswers(next);
    try {
      sessionStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* answers stay in memory */
    }
  };

  const submit = useCallback(async () => {
    if (done.current) return;
    done.current = true;
    setBusy(true);
    const at = new Date().toISOString();
    for (const q of questions) {
      const sel = answers[q.id] ?? [];
      await store.addAttempt(q.id, { at, ok: sameKeys(sel, q.correctKeys), sel, conf: null, mode: "exam", sid: session.id, self: false });
    }
    await finish(store, session);
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* nothing to clean */
    }
  }, [answers, questions, session, store, key]);

  useEffect(() => {
    if (remaining === 0) submit();
  }, [remaining, submit]);

  const q = questions[index];
  const opts = useMemo(() => (q ? ordered(q, session.id) : []), [q, session.id]);
  if (!q) return null;
  const sel = answers[q.id] ?? [];
  const answered = questions.filter((x) => (answers[x.id] ?? []).length).length;
  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);

  function toggle(k: string) {
    const next = q.type === "multi" ? (sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k]) : [k];
    save({ ...answers, [q.id]: next });
  }

  return (
    <div className="runner">
      <div className="row between">
        <h1 className="h2">Exam simulation</h1>
        <div className={`timer ${remaining < 300000 ? "low" : ""}`} role="timer" aria-label="Time remaining">
          {mm}:{String(ss).padStart(2, "0")}
        </div>
      </div>
      <ProgressBar index={index} total={questions.length} answered={answered} />
      <article className="qcard">
        <div className="chips">
          <span className="chip static">Question {index + 1}</span>
          {q.type === "multi" && <span className="chip static warn">Choose {q.correctKeys.length}</span>}
        </div>
        <h2 className="prompt">{q.prompt}</h2>
        <ul className="options">
          {opts.map((o) => (
            <li key={o.key}>
              <button role={q.type === "multi" ? "checkbox" : "radio"} aria-checked={sel.includes(o.key)} className={sel.includes(o.key) ? "opt sel" : "opt"} onClick={() => toggle(o.key)}>
                <span className="grow">{o.text}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="row between mt">
          <button className="btn" disabled={index === 0} onClick={() => setIndex(index - 1)}>
            Previous
          </button>
          {index + 1 < questions.length ? (
            <button className="btn btn-primary" onClick={() => setIndex(index + 1)}>
              Next
            </button>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={() => setAskSubmit(true)}>
              Submit exam
            </button>
          )}
        </div>
      </article>
      <nav className="qgrid" aria-label="Jump to question">
        {questions.map((x, i) => (
          <button
            key={x.id}
            aria-current={i === index}
            aria-label={`Question ${i + 1}${(answers[x.id] ?? []).length ? ", answered" : ""}`}
            className={`${i === index ? "cur" : ""} ${(answers[x.id] ?? []).length ? "ans" : ""}`}
            onClick={() => setIndex(i)}
          >
            {i + 1}
          </button>
        ))}
      </nav>
      <div className="center mt">
        {askSubmit ? (
          <div className="confirm-box" role="group">
            <p className="small">
              Submit now? {questions.length - answered} question{questions.length - answered === 1 ? "" : "s"} unanswered.
            </p>
            <div className="row center">
              <button className="btn btn-primary" disabled={busy} onClick={submit}>
                {busy ? "Marking…" : "Submit and mark"}
              </button>
              <button className="btn" onClick={() => setAskSubmit(false)}>
                Keep going
              </button>
            </div>
          </div>
        ) : (
          <button className="btn" onClick={() => setAskSubmit(true)}>
            Submit exam ({answered}/{questions.length} answered)
          </button>
        )}
        <p className="tiny muted mt">
          <button className="linkbtn" onClick={() => go("practice")}>
            Leave
          </button>{" "}
          (your answers so far are kept in this browser tab until you submit)
        </p>
      </div>
    </div>
  );
}

function Summary({ session, questions }: { session: Session; questions: Question[] }) {
  const { store, go } = useApp();
  const answers = sessionAnswers(store, session);
  const rows = questions.filter((q) => answers[q.id]);
  const correct = rows.filter((q) => answers[q.id].ok).length;
  const total = session.mode === "exam" ? questions.length : rows.length;
  const passMark = Math.ceil(total * (EXAM.passMark / EXAM.questions));
  const missed = rows.filter((q) => !answers[q.id].ok).length;

  async function practiseWeak() {
    const { ids, reasons } = selectQuestions(deriveAll(store), { mode: "weak", count: Math.max(missed, 10) });
    const s: Session = { id: newId(), mode: "weak", config: { mode: "weak" }, qids: ids, reasons, startedAt: new Date().toISOString(), finishedAt: null, timeLimit: null };
    await store.putSession(s);
    go("session", s.id);
  }

  return (
    <div className="runner wide-runner">
      <div className="panel center">
        <p className="small muted">{MODES[session.mode].label} complete</p>
        <p className="score num">
          {correct}/{total}
        </p>
        <p className="muted">{total ? Math.round((correct / total) * 100) : 0}% correct</p>
        {session.mode === "exam" && (
          <p className={`verdict inline ${correct >= passMark ? "good" : "bad"}`}>
            {correct >= passMark ? "Pass" : "Not yet a pass"}: pass mark {passMark}/{total}
          </p>
        )}
        <div className="row wrap center mt">
          {missed > 0 && (
            <button className="btn btn-primary" onClick={practiseWeak}>
              Practise weak areas now
            </button>
          )}
          <button className="btn" onClick={() => go("practice")}>
            New session
          </button>
          <button className="btn" onClick={() => go("dashboard")}>
            Dashboard
          </button>
        </div>
      </div>
      <h2 className="h3 mt-l">Review answers</h2>
      <ul className="stack">
        {rows.map((q) => {
          const a = answers[q.id];
          return (
            <li key={q.id} className={`review ${a.ok ? "good" : "bad"}`}>
              <div className="row between top">
                <button className="linkbtn strong left" onClick={() => go("q", q.id)}>
                  {q.prompt}
                </button>
                <span className={`tag ${a.ok ? "good" : "bad"}`}>{a.ok ? "Correct" : "Incorrect"}</span>
              </div>
              <p className="small">
                <span className="muted">Answer: </span>
                {answerOf(q)}
              </p>
              {!a.ok && a.sel.length > 0 && <p className="small bad-text">You chose: {q.options.filter((o) => a.sel.includes(o.key)).map((o) => o.text).join("; ")}</p>}
              {!a.ok && q.explanation && <p className="small muted">{q.explanation}</p>}
              <p className="tiny muted">{ref(q)}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
