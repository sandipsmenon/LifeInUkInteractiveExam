import * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Confidence } from "../../../src/lib/srs";
import { CAT_NAME, CATEGORIES, PASS_MARK, PER_TEST, STYLES, TEST_MINUTES, newId, type Attempt, type Mode, type Question, type Session } from "../model";
import { answerOf, catSlugs, derive, deriveAll, ref, selectQuestions, sessionAnswers, type StartConfig } from "../logic";
import type { Store } from "../store";
import { FlagButton } from "./bank";
import { PageHeader, Panel, StatusPill, TipBox, useApp } from "../ui";
import { startTest } from "./tests";

async function startPractice(store: Store, cfg: StartConfig, label: string): Promise<string> {
  const ids = selectQuestions(deriveAll(store), cfg);
  const s: Session = {
    id: newId(),
    mode: cfg.mode,
    test: null,
    label,
    config: cfg as unknown as Record<string, unknown>,
    qids: ids,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    timeLimit: null,
  };
  await store.putSession(s);
  return s.id;
}

const COUNTS: [string, string][] = [
  ["10", "10"],
  ["24", "24"],
  ["50", "50"],
  ["all", "All"],
];

// ------------------------------------------------------------------ practice home

export function PracticeHome({ initial }: { initial: string | null }) {
  const { store, go } = useApp();
  const all = deriveAll(store);
  const [kind, preset] = (initial ?? "").split(".");
  const [count, setCount] = useState("24");
  const [err, setErr] = useState<string | null>(null);

  async function start(cfg: StartConfig, label: string) {
    setErr(null);
    try {
      go("session", await startPractice(store, { ...cfg, count: count === "all" ? "all" : Number(count) }, label));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const Row = ({ name, desc, total, missed, onStart, hi }: { name: string; desc?: string; total: number; missed: number; onStart: () => void; hi?: boolean }) => (
    <li className={`pick ${hi ? "hi" : ""}`}>
      <div className="minw0 grow">
        <div className="strong">{name}</div>
        <div className="tiny muted">
          {desc ? `${desc} · ` : ""}
          {total} questions{missed ? ` · ${missed} to retry` : ""}
        </div>
      </div>
      <button className="btn btn-sm" onClick={onStart} disabled={!total}>
        Practise
      </button>
    </li>
  );

  return (
    <>
      <PageHeader
        title="Practice"
        sub="Pick a question style or a topic from every test. You see the answer straight away, with a memory tip when you get one wrong."
        actions={
          <div className="row small">
            <label htmlFor="pcount" className="muted">
              Questions
            </label>
            <select id="pcount" className="auto" value={count} onChange={(e) => setCount(e.target.value)}>
              {COUNTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        }
      />
      {err && (
        <p className="err mb" role="alert">
          {err}
        </p>
      )}
      <div className="grid2">
        <Panel title="By question style">
          <ul className="picks">
            {STYLES.map((s) => {
              const ds = all.filter((d) => s.match(d.q));
              return (
                <Row
                  key={s.key}
                  name={s.name}
                  desc={s.description}
                  total={ds.length}
                  missed={ds.filter((d) => d.status === "missed").length}
                  hi={kind === "style" && preset === s.key}
                  onStart={() => start({ mode: "style", style: s.key }, s.name)}
                />
              );
            })}
          </ul>
        </Panel>
        <Panel title="By topic">
          <ul className="picks">
            {CATEGORIES.filter((c) => all.some((d) => catSlugs(d.q).includes(c.slug))).map((c) => {
              const ds = all.filter((d) => catSlugs(d.q).includes(c.slug));
              return (
                <Row
                  key={c.slug}
                  name={c.name}
                  total={ds.length}
                  missed={ds.filter((d) => d.status === "missed").length}
                  hi={kind === "topic" && preset === c.slug}
                  onStart={() => start({ mode: "topic", topic: c.slug }, c.name)}
                />
              );
            })}
          </ul>
        </Panel>
      </div>
      <div className="grid2 mt-l">
        <Panel title="Mixed practice">
          <p className="small muted">A shuffle from every test. Questions you haven’t answered yet, or got wrong, come first.</p>
          <div>
            <button className="btn btn-primary" onClick={() => start({ mode: "mixed" }, "Mixed practice")}>
              Start mixed practice
            </button>
          </div>
        </Panel>
        <Panel title="Memory drills">
          <p className="small muted">Games built from the questions: put dates in order, type the number, match people to what they did, flashcards.</p>
          <div className="row wrap">
            {(
              [
                ["timeline", "Date timeline"],
                ["numbers", "Number drill"],
                ["names", "Name recall"],
                ["compare", "Look-alikes"],
                ["flashcards", "Flashcards"],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className="btn btn-sm" onClick={() => go("drill", k)}>
                {l}
              </button>
            ))}
          </div>
        </Panel>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ retry mistakes

export function RetryHome() {
  const { store, go } = useApp();
  const all = deriveAll(store);
  const missed = all.filter((d) => d.status === "missed").sort((a, b) => b.last!.at.localeCompare(a.last!.at));
  const fixed = all.filter((d) => d.status === "learned" && d.wrong > 0).length;
  const [err, setErr] = useState<string | null>(null);

  async function retry(count: number | "all", label: string) {
    setErr(null);
    try {
      go("session", await startPractice(store, { mode: "retry", count }, label));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Retry mistakes"
        sub="Every question you got wrong lands here, from tests and practice. Answer it correctly and it leaves the list."
        actions={
          missed.length > 0 && (
            <>
              <button className="btn btn-primary" onClick={() => retry("all", "Retry all mistakes")}>
                Retry all {missed.length}
              </button>
              {missed.length > 10 && (
                <button className="btn" onClick={() => retry(10, "Retry 10 latest mistakes")}>
                  Latest 10
                </button>
              )}
            </>
          )
        }
      />
      {err && <p className="err mb">{err}</p>}
      {missed.length === 0 ? (
        <Panel>
          <p className="strong">Nothing to retry.</p>
          <p className="small muted">
            {fixed ? `You have fixed all ${fixed} questions you once got wrong. ` : ""}Take a test and any question you miss will appear here.
          </p>
          <div>
            <button className="btn" onClick={() => go("tests")}>
              Go to tests
            </button>
          </div>
        </Panel>
      ) : (
        <>
          <p className="small muted mb">
            {missed.length} to retry · {fixed} fixed so far
          </p>
          <ul className="stack">
            {missed.map((d) => (
              <li key={d.q.id} className="review bad">
                <div className="row between top">
                  <span className="strong">{d.q.prompt}</span>
                  <span className="tiny muted nowrap">
                    wrong {d.wrong}×
                  </span>
                </div>
                <p className="small">
                  <span className="muted">Answer: </span>
                  {answerOf(d.q)}
                </p>
                <TipBox q={d.q} compact />
                <p className="tiny muted">{ref(d.q)}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ sessions

function ordered(q: Question, seed: string) {
  if (q.options.length === 2) return q.options; // keep True/False and Yes/No in their natural order
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

const sameKeys = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();

export function SessionView({ id }: { id: string }) {
  const { store, go } = useApp();
  const s = store.sessions.get(id);
  if (!s) {
    return (
      <div className="panel narrow">
        <h1 className="h2">Session not found</h1>
        <button className="btn" onClick={() => go("tests")}>
          Back to tests
        </button>
      </div>
    );
  }
  const qs = s.qids.map((q) => store.questions.get(q)).filter((q): q is Question => !!q);
  if (s.finishedAt) return <Summary session={s} questions={qs} />;
  if (s.mode === "test") return <TestRunner session={s} questions={qs} />;
  return <StudyRunner session={s} questions={qs} />;
}

async function finish(store: Store, s: Session) {
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

function Chips({ q, label }: { q: Question; label?: string }) {
  return (
    <div className="chips">
      <span className="chip static">{label ?? ref(q)}</span>
      {q.cats.slice(0, 2).map((c) => (
        <span key={c.slug} className="chip static">
          {CAT_NAME[c.slug]}
        </span>
      ))}
      {q.correctKeys.length > 1 && <span className="chip static warn">Choose {q.correctKeys.length}</span>}
    </div>
  );
}

/** Practice and retry: immediate feedback, a memory tip after a wrong answer. */
function StudyRunner({ session, questions }: { session: Session; questions: Question[] }) {
  const { store, go } = useApp();
  const answers = sessionAnswers(store, session);
  const firstOpen = questions.findIndex((q) => !answers[q.id]);
  const [index, setIndex] = useState(firstOpen === -1 ? Math.max(questions.length - 1, 0) : firstOpen);
  const [selected, setSelected] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [fb, setFb] = useState<{ ok: boolean; revealed: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const q = questions[index];
  const opts = useMemo(() => (q ? ordered(q, session.id) : []), [q, session.id]);
  const answeredCount = Object.keys(answers).length;
  const correctCount = Object.values(answers).filter((a) => a.ok).length;

  const record = useCallback(
    async (sel: string[], self?: boolean) => {
      if (!q) return;
      const ok = self !== undefined ? self : sameKeys(sel, q.correctKeys);
      const a: Attempt = { at: new Date().toISOString(), ok, sel, conf: confidence, mode: session.mode, sid: session.id, self: self !== undefined };
      setFb({ ok, revealed: false });
      setBusy(true);
      try {
        await store.addAttempt(q.id, a);
      } finally {
        setBusy(false);
      }
    },
    [q, confidence, session, store],
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
    if (index + 1 >= questions.length) return finish(store, session);
    setIndex(index + 1);
    setSelected([]);
    setConfidence(null);
    setFb(null);
    window.scrollTo({ top: 0 });
  }

  function toggle(k: string) {
    if (fb) return;
    if (q.correctKeys.length > 1) setSelected(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);
    else setSelected([k]);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(t.tagName) && e.key === "Enter") return;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      const n = Number(e.key);
      if (!fb && n >= 1 && n <= opts.length) toggle(opts[n - 1].key);
      if (e.key === "Enter" && !busy) {
        if (fb && !fb.revealed) next();
        else if (!fb && selected.length) record(selected);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!q) return <p>This session has no questions (they may have been removed).</p>;
  const marked = fb && !fb.revealed;
  const d = derive(q, store.attemptsOf(q.id));

  return (
    <div className="runner">
      <div className="row between">
        <h1 className="h2">{session.label}</h1>
        <button className="linkbtn muted" onClick={() => go(session.mode === "retry" ? "retry" : "practice")}>
          Exit
        </button>
      </div>
      <ProgressBar index={index} total={questions.length} answered={answeredCount} correct={correctCount} />
      <article className="qcard" aria-live="polite">
        <Chips q={q} />
        <h2 className="prompt">{q.prompt}</h2>
        <ul className="options" role={q.correctKeys.length > 1 ? "group" : "radiogroup"} aria-label="Answer options">
          {opts.map((o, i) => {
            const sel = selected.includes(o.key);
            const right = q.correctKeys.includes(o.key);
            let cls = sel ? "opt sel" : "opt";
            if (fb) cls = right ? "opt right" : sel ? "opt wrong" : "opt dim";
            return (
              <li key={o.key}>
                <button role={q.correctKeys.length > 1 ? "checkbox" : "radio"} aria-checked={sel} disabled={!!fb} className={cls} onClick={() => toggle(o.key)}>
                  <span className="okey">{i + 1}</span>
                  <span className="grow">{o.text}</span>
                  {fb && right && <span className="tag good">Correct answer</span>}
                  {fb && sel && !right && <span className="tag bad">Your answer</span>}
                </button>
              </li>
            );
          })}
        </ul>

        {!fb && (
          <>
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
            <div className="row wrap">
              <button className="btn btn-primary grow" disabled={!selected.length || busy} onClick={() => record(selected)}>
                Check answer
              </button>
              <button className="btn" onClick={() => setFb({ ok: false, revealed: true })}>
                I don’t know, show me
              </button>
            </div>
          </>
        )}

        {fb?.revealed && (
          <div className="stack">
            <p className="small">
              The answer is: <strong>{answerOf(q)}</strong>
            </p>
            <TipBox q={q} />
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
              {fb.ok ? "Correct" : `Not quite. The answer is: ${answerOf(q)}`}
            </div>
            {q.explanation && <p className="explain">{q.explanation}</p>}
            {!fb.ok && <TipBox q={q} />}
            <p className="tiny muted row wrap">
              <StatusPill status={d.status} />
              <button className="linkbtn" onClick={() => override(!fb.ok)}>
                {fb.ok ? "Actually I got this wrong" : "I misclicked, mark it correct"}
              </button>
            </p>
          </div>
        )}

        <div className="qfoot">
          <div className="row">
            <FlagButton q={q} />
            <button className="linkbtn tiny muted" onClick={() => go("q", q.id)}>
              Details
            </button>
          </div>
          {marked && (
            <button className="btn btn-primary" onClick={next} autoFocus>
              {index + 1 >= questions.length ? "Finish" : "Next"}
            </button>
          )}
        </div>
      </article>
      <p className="tiny muted center hide-sm">Keys: 1–{Math.max(opts.length, 2)} choose · Enter check / next</p>
    </div>
  );
}

/** One of the 40 tests: like the real exam, nothing is marked until you submit. */
function TestRunner({ session, questions }: { session: Session; questions: Question[] }) {
  const { store, go } = useApp();
  const key = `test:${session.id}`;
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
  const timed = !!session.timeLimit;
  const deadline = new Date(session.startedAt).getTime() + (session.timeLimit ?? 0) * 1000;
  const remaining = timed ? Math.max(0, deadline - now) : Infinity;

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
      await store.addAttempt(q.id, { at, ok: sameKeys(sel, q.correctKeys), sel, conf: null, mode: "test", sid: session.id, self: false });
    }
    await finish(store, session);
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* nothing to clean */
    }
  }, [answers, questions, session, store, key]);

  useEffect(() => {
    if (timed && remaining === 0) submit();
  }, [timed, remaining, submit]);

  const q = questions[index];
  const opts = useMemo(() => (q ? ordered(q, session.id) : []), [q, session.id]);
  if (!q) return null;
  const sel = answers[q.id] ?? [];
  const answered = questions.filter((x) => (answers[x.id] ?? []).length).length;
  const elapsed = Math.max(0, now - new Date(session.startedAt).getTime());
  const shown = timed ? remaining : elapsed;
  const mm = Math.floor(shown / 60000);
  const ss = Math.floor((shown % 60000) / 1000);

  function toggle(k: string) {
    const next = q.correctKeys.length > 1 ? (sel.includes(k) ? sel.filter((x) => x !== k) : [...sel, k]) : [k];
    save({ ...answers, [q.id]: next });
  }

  return (
    <div className="runner">
      <div className="row between">
        <h1 className="h2">{session.label}</h1>
        <div className={`timer ${timed && remaining < 300000 ? "low" : ""}`} role="timer" aria-label={timed ? "Time remaining" : "Time taken"}>
          {mm}:{String(ss).padStart(2, "0")}
        </div>
      </div>
      <ProgressBar index={index} total={questions.length} answered={answered} />
      <article className="qcard">
        <div className="chips">
          <span className="chip static">Question {index + 1}</span>
          {q.correctKeys.length > 1 && <span className="chip static warn">Choose {q.correctKeys.length}</span>}
        </div>
        <h2 className="prompt">{q.prompt}</h2>
        <ul className="options">
          {opts.map((o, i) => (
            <li key={o.key}>
              <button role={q.correctKeys.length > 1 ? "checkbox" : "radio"} aria-checked={sel.includes(o.key)} className={sel.includes(o.key) ? "opt sel" : "opt"} onClick={() => toggle(o.key)}>
                <span className="okey">{i + 1}</span>
                <span className="grow">{o.text}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="row between">
          <button className="btn" disabled={index === 0} onClick={() => setIndex(index - 1)}>
            Previous
          </button>
          {index + 1 < questions.length ? (
            <button className="btn btn-primary" onClick={() => setIndex(index + 1)}>
              Next
            </button>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={() => setAskSubmit(true)}>
              Submit test
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
      <div className="center">
        {askSubmit ? (
          <div className="confirm-box" role="group">
            <p className="small">
              Submit now?{" "}
              {questions.length - answered ? `${questions.length - answered} question${questions.length - answered === 1 ? " is" : "s are"} unanswered and will count as wrong.` : "All questions answered."}
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
            Submit test ({answered}/{questions.length} answered)
          </button>
        )}
        <p className="tiny muted mt">
          <button className="linkbtn" onClick={() => go("tests")}>
            Leave for now
          </button>{" "}
          (your answers are kept in this browser tab until you submit)
        </p>
      </div>
    </div>
  );
}

function Summary({ session, questions }: { session: Session; questions: Question[] }) {
  const { store, go } = useApp();
  const answers = sessionAnswers(store, session);
  const rows = questions.filter((q) => answers[q.id]);
  const wrong = rows.filter((q) => !answers[q.id].ok);
  const correct = rows.length - wrong.length;
  const isTest = session.mode === "test";
  const total = isTest ? questions.length : rows.length;
  const passMark = Math.ceil((total * PASS_MARK) / PER_TEST);
  const [showRight, setShowRight] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function retryThese() {
    setErr(null);
    try {
      go("session", await startPractice(store, { mode: "retry", onlyIds: wrong.map((q) => q.id) }, `Retry: ${session.label}`));
    } catch (e) {
      setErr((e as Error).message);
    }
  }
  async function retake() {
    let timed = true;
    try {
      timed = localStorage.getItem("timedTests") !== "0";
    } catch {
      /* default on */
    }
    go("session", await startTest(store, session.test!, timed));
  }
  const nextTest = isTest ? session.test! + 1 : null;
  const nextAvailable = nextTest !== null && [...store.questions.values()].some((q) => q.exam === nextTest);

  return (
    <div className="runner wide-runner">
      <div className="panel center result-head">
        <p className="eyebrow">{session.label} · results</p>
        <p className="score num">
          {correct}/{total}
        </p>
        {isTest ? (
          <p className={`verdict inline ${correct >= passMark ? "good" : "bad"}`}>
            {correct >= passMark ? "Pass" : "Not a pass yet"}: you need {passMark} of {total}
          </p>
        ) : (
          <p className="muted">{total ? Math.round((correct / total) * 100) : 0}% correct</p>
        )}
        <div className="row wrap center mt">
          {wrong.length > 0 && (
            <button className="btn btn-primary" onClick={retryThese}>
              Retry the {wrong.length} I got wrong
            </button>
          )}
          {isTest && (
            <button className="btn" onClick={retake}>
              Retake Test {session.test}
            </button>
          )}
          {nextAvailable && (
            <button className="btn" onClick={() => go("tests")}>
              Next: Test {nextTest}
            </button>
          )}
          <button className="btn" onClick={() => go("home")}>
            Home
          </button>
        </div>
        {err && <p className="err">{err}</p>}
      </div>

      {wrong.length > 0 ? (
        <>
          <h2 className="h3 mt-l">What you missed, and how to remember it</h2>
          <ul className="stack">
            {wrong.map((q) => {
              const a = answers[q.id];
              return (
                <li key={q.id} className="review bad">
                  <p className="strong">{q.prompt}</p>
                  {a.sel.length > 0 ? (
                    <p className="small bad-text">You chose: {q.options.filter((o) => a.sel.includes(o.key)).map((o) => o.text).join("; ")}</p>
                  ) : (
                    <p className="small bad-text">Not answered</p>
                  )}
                  <p className="small good-text strong">Answer: {answerOf(q)}</p>
                  {q.explanation && <p className="small muted">{q.explanation}</p>}
                  <TipBox q={q} />
                  <p className="tiny muted">{ref(q)}</p>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p className="center strong mt-l">A clean sweep: nothing to fix.</p>
      )}
      {rows.length > wrong.length && (
        <div className="mt-l">
          <button className="linkbtn small" aria-expanded={showRight} onClick={() => setShowRight(!showRight)}>
            {showRight ? "Hide" : "Show"} the {rows.length - wrong.length} you got right
          </button>
          {showRight && (
            <ul className="stack mt">
              {rows
                .filter((q) => answers[q.id].ok)
                .map((q) => (
                  <li key={q.id} className="review good">
                    <p className="small strong">{q.prompt}</p>
                    <p className="small">{answerOf(q)}</p>
                  </li>
                ))}
            </ul>
          )}
        </div>
      )}
      {isTest && <p className="tiny muted mt-l center">Real test format: {PER_TEST} questions, {TEST_MINUTES} minutes, {PASS_MARK} to pass.</p>}
    </div>
  );
}

export type { Mode };
