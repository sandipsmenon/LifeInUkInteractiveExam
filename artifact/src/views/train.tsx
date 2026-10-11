import * as React from "react";
import { useMemo, useRef, useState } from "react";
import {
  allFacts,
  confusableGroups,
  datedFacts,
  nameFacts,
  numberFacts,
  numberRecallCorrect,
  shuffle,
  type ComparisonGroup,
  type DatedFact,
  type Fact,
  type FactSource,
  type NumberFact,
} from "../../../src/lib/facts";
import type { Confidence } from "../../../src/lib/srs";
import { CATEGORIES } from "../model";
import { answerOf, ref } from "../logic";
import type { Store } from "../store";
import { PageHeader, Segmented, useApp } from "../ui";

function sources(store: Store): FactSource[] {
  return store.allQuestions().map((q) => ({
    id: q.id,
    prompt: q.prompt,
    options: q.options,
    correctKeys: q.correctKeys,
    categories: q.cats.map((c) => c.slug),
    topics: q.topics,
    mockExamNumber: q.exam,
    questionNumber: q.qnum,
  }));
}

const TOOLS = [
  { kind: "timeline", title: "Date timeline", text: "Put events in chronological order and match events to their dates.", min: 3, unit: "dated facts", get: datedFacts },
  { kind: "numbers", title: "Number drill", text: "Type the figure from memory: members, ages, percentages, fines.", min: 1, unit: "numerical facts", get: numberFacts },
  { kind: "names", title: "Name recall", text: "Match people to what they did, their title or role.", min: 3, unit: "people", get: nameFacts },
  { kind: "matching", title: "Question ↔ answer matching", text: "Match a set of questions to their answers.", min: 3, unit: "questions", get: allFacts },
  { kind: "compare", title: "Similar-fact comparison", text: "Tell apart facts that are easy to mix up, like start and end dates.", min: 1, unit: "confusable pairs", get: confusableGroups },
  { kind: "flashcards", title: "Flashcards", text: "Flip, recall and rate yourself. Ratings update your revision schedule.", min: 1, unit: "cards", get: allFacts },
] as const;

export function TrainHome() {
  const { store, go } = useApp();
  const src = sources(store);
  return (
    <>
      <PageHeader title="Memory training" sub="Exercises use only facts from your own questions. Every item links back to its source question, and nothing is reworded." />
      <div className="grid3">
        {TOOLS.map((t) => {
          const n = (t.get as (s: FactSource[]) => unknown[])(src).length;
          return (
            <div key={t.kind} className="panel tool">
              <h2>{t.title}</h2>
              <p className="small muted grow">{t.text}</p>
              <p className="tiny muted">
                {n} {t.unit} available
              </p>
              {n >= t.min ? (
                <button className="btn btn-primary" onClick={() => go("drill", t.kind)}>
                  Start
                </button>
              ) : (
                <p className="tiny warn-text">Not enough data yet. Import more questions.</p>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

function Src({ f }: { f: Fact }) {
  const { go } = useApp();
  return (
    <button className="linkbtn tiny muted" onClick={() => go("q", f.questionId)} title="Open the source question">
      {f.ref} ↗
    </button>
  );
}

async function recall(store: Store, qid: string, mode: string, ok: boolean, conf: Confidence | null = null) {
  try {
    await store.addAttempt(qid, { at: new Date().toISOString(), ok, sel: [], conf, mode, sid: null, self: true });
  } catch {
    /* the store shows the error banner */
  }
}

export function TrainView({ kind }: { kind: string }) {
  const { store, go } = useApp();
  // Snapshot the facts once per visit so drills don't reshuffle when progress is saved.
  const src = useMemo(() => sources(store), [store]);
  const tool = TOOLS.find((t) => t.kind === kind);
  let body: React.ReactNode = <p>Unknown exercise.</p>;
  if (kind === "timeline") body = <Timeline facts={datedFacts(src)} />;
  if (kind === "numbers") body = <NumberDrill facts={numberFacts(src)} />;
  if (kind === "names") body = <Matching facts={nameFacts(src)} left="Description" right="Person" />;
  if (kind === "matching") body = <Matching facts={allFacts(src)} left="Question" right="Answer" />;
  if (kind === "compare") body = <Compare groups={confusableGroups(src)} />;
  if (kind === "flashcards") body = <Flashcards />;
  return (
    <div className="runner wide-runner">
      <div className="row between mb">
        <h1 className="h2">{tool?.title ?? "Training"}</h1>
        <button className="linkbtn muted" onClick={() => go("train")}>
          All exercises
        </button>
      </div>
      {body}
    </div>
  );
}

const Empty = ({ what }: { what: string }) => <div className="panel center muted">Not enough {what} in your question bank yet.</div>;

function pickDistinct<T extends Fact>(facts: T[], key: (f: T) => string | number, n = 5) {
  const seen = new Set<string | number>();
  return shuffle(facts).filter((f) => (seen.has(key(f)) ? false : (seen.add(key(f)), true))).slice(0, n);
}

function Timeline({ facts }: { facts: DatedFact[] }) {
  const [tab, setTab] = useState<"order" | "match">("order");
  if (facts.length < 3) return <Empty what="dated facts" />;
  return (
    <>
      <Segmented
        label="Exercise"
        value={tab}
        onChange={setTab}
        options={[
          ["order", "Arrange in order"],
          ["match", "Match event to date"],
        ]}
      />
      <div className="mt">{tab === "order" ? <OrderGame facts={facts} /> : <MatchDates facts={facts} />}</div>
    </>
  );
}

function OrderGame({ facts }: { facts: DatedFact[] }) {
  const fresh = () => {
    const r = pickDistinct(facts, (f) => f.sortValue);
    return { round: r, order: shuffle(r) };
  };
  const [st, setSt] = useState(fresh);
  const [checked, setChecked] = useState(false);
  const right = [...st.round].sort((a, b) => a.sortValue - b.sortValue);
  const score = st.order.filter((f, i) => f.questionId === right[i].questionId).length;
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= st.order.length) return;
    const o = st.order.slice();
    [o[i], o[j]] = [o[j], o[i]];
    setSt({ ...st, order: o });
  };
  return (
    <div className="panel">
      <p className="small muted">
        Arrange from <strong>earliest</strong> (top) to <strong>latest</strong> (bottom). Dates stay hidden until you check.
      </p>
      <ol className="stack">
        {st.order.map((f, i) => {
          const ok = checked && f.questionId === right[i].questionId;
          return (
            <li key={f.questionId} className={`drill-item ${checked ? (ok ? "good" : "bad") : ""}`}>
              <span className="num muted">{i + 1}</span>
              <div className="grow minw0">
                <p className="small strong">{f.prompt}</p>
                {checked && <p className="small">{f.answer}</p>}
                <Src f={f} />
              </div>
              {!checked && (
                <div className="updown">
                  <button className="btn btn-sm" disabled={i === 0} aria-label={`Move up: ${f.prompt}`} onClick={() => move(i, -1)}>
                    ↑
                  </button>
                  <button className="btn btn-sm" disabled={i === st.order.length - 1} aria-label={`Move down: ${f.prompt}`} onClick={() => move(i, 1)}>
                    ↓
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {checked && (
        <div className="result" role="status">
          <p className="strong">
            {score}/{st.order.length} in the right position. Correct order:
          </p>
          <ol>
            {right.map((f) => (
              <li key={f.questionId}>
                <strong>{f.answer}</strong>: {f.prompt}
              </li>
            ))}
          </ol>
        </div>
      )}
      <div className="mt">
        {checked ? (
          <button className="btn btn-primary" onClick={() => { setSt(fresh()); setChecked(false); }}>
            New round
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => setChecked(true)}>
            Check order
          </button>
        )}
      </div>
    </div>
  );
}

function MatchDates({ facts }: { facts: DatedFact[] }) {
  const fresh = () => {
    const r = pickDistinct(facts, (f) => f.answer);
    return { round: r, choices: shuffle(r.map((f) => f.answer)) };
  };
  const [st, setSt] = useState(fresh);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const score = st.round.filter((f) => picks[f.questionId] === f.answer).length;
  return (
    <div className="panel">
      <p className="small muted">Choose the date that answers each question.</p>
      <ul className="stack">
        {st.round.map((f) => {
          const ok = picks[f.questionId] === f.answer;
          return (
            <li key={f.questionId} className={`drill-item col ${checked ? (ok ? "good" : "bad") : ""}`}>
              <label htmlFor={`md-${f.questionId}`} className="small strong">
                {f.prompt}
              </label>
              <select id={`md-${f.questionId}`} disabled={checked} value={picks[f.questionId] ?? ""} onChange={(e) => setPicks({ ...picks, [f.questionId]: e.target.value })}>
                <option value="">Choose…</option>
                {st.choices.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              {checked && !ok && (
                <p className="small">
                  Answer: <strong>{f.answer}</strong>
                </p>
              )}
              <Src f={f} />
            </li>
          );
        })}
      </ul>
      {checked && (
        <p className="strong mt" role="status">
          {score}/{st.round.length} correct
        </p>
      )}
      <div className="mt">
        {checked ? (
          <button className="btn btn-primary" onClick={() => { setSt(fresh()); setPicks({}); setChecked(false); }}>
            New round
          </button>
        ) : (
          <button className="btn btn-primary" disabled={!Object.keys(picks).length} onClick={() => setChecked(true)}>
            Check
          </button>
        )}
      </div>
    </div>
  );
}

function NumberDrill({ facts }: { facts: NumberFact[] }) {
  const { store } = useApp();
  const [deck, setDeck] = useState(() => shuffle(facts));
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<boolean | null>(null);
  const [score, setScore] = useState({ right: 0, done: 0 });
  const input = useRef<HTMLInputElement>(null);
  if (!facts.length) return <Empty what="numerical facts" />;
  const f = deck[i % deck.length];
  function check(e: React.FormEvent) {
    e.preventDefault();
    if (result !== null || !typed.trim()) return;
    const ok = numberRecallCorrect(typed, f);
    setResult(ok);
    setScore((s) => ({ right: s.right + (ok ? 1 : 0), done: s.done + 1 }));
    recall(store, f.questionId, "number_drill", ok);
  }
  function next() {
    if ((i + 1) % deck.length === 0) setDeck(shuffle(facts));
    setI(i + 1);
    setTyped("");
    setResult(null);
    setTimeout(() => input.current?.focus(), 0);
  }
  return (
    <div className="qcard">
      <div className="row between tiny muted">
        <span>
          Card {(i % deck.length) + 1} of {deck.length}
        </span>
        <span className="num">
          {score.right}/{score.done} correct
        </span>
      </div>
      <h2 className="prompt">{f.prompt}</h2>
      <form onSubmit={check} className="row">
        <label htmlFor="numin" className="sr-only">
          Your answer
        </label>
        <input id="numin" ref={input} inputMode="decimal" autoComplete="off" placeholder="Type the number" value={typed} disabled={result !== null} onChange={(e) => setTyped(e.target.value)} />
        {result === null && <button className="btn btn-primary">Check</button>}
      </form>
      {result !== null && (
        <div className="mt" role="status">
          <p className={`verdict ${result ? "good" : "bad"}`}>
            {result ? "Correct" : "Not quite"}: the answer is <strong>{f.answer}</strong>
          </p>
          <div className="row between mt">
            <Src f={f} />
            <button className="btn btn-primary" onClick={next} autoFocus>
              Next
            </button>
          </div>
          <p className="tiny muted">Saved to your progress for this question.</p>
        </div>
      )}
    </div>
  );
}

function Matching({ facts, left, right }: { facts: Fact[]; left: string; right: string }) {
  const fresh = () => {
    const r = pickDistinct(facts, (f) => f.answer.toLowerCase());
    return { round: r, answers: shuffle(r.map((f) => f.questionId)) };
  };
  const [st, setSt] = useState(fresh);
  const [active, setActive] = useState<string | null>(null);
  const [pairs, setPairs] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  if (facts.length < 3) return <Empty what="facts" />;
  const byId = new Map(st.round.map((f) => [f.questionId, f]));
  const used = new Set(Object.values(pairs));
  const score = st.round.filter((f) => pairs[f.questionId] === f.questionId).length;
  function choose(rid: string) {
    if (!active || checked) return;
    const next = Object.fromEntries(Object.entries(pairs).filter(([, v]) => v !== rid));
    next[active] = rid;
    setPairs(next);
    setActive(null);
  }
  return (
    <div className="panel">
      <p className="small muted">
        Select a {left.toLowerCase()}, then the {right.toLowerCase()} that goes with it.
      </p>
      <div className="grid2">
        <div>
          <h2 className="label">{left}</h2>
          <ul className="stack">
            {st.round.map((f, i) => {
              const p = pairs[f.questionId];
              const ok = checked && p === f.questionId;
              return (
                <li key={f.questionId}>
                  <button
                    aria-pressed={active === f.questionId}
                    className={`match-item ${active === f.questionId ? "act" : ""} ${checked ? (ok ? "good" : "bad") : ""}`}
                    onClick={() => !checked && setActive(active === f.questionId ? null : f.questionId)}
                  >
                    <span className="muted strong">{i + 1}. </span>
                    {f.prompt}
                    {p && <span className="block tiny accent-text">→ {byId.get(p)?.answer}</span>}
                    {checked && !ok && <span className="block tiny good-text">Answer: {f.answer}</span>}
                  </button>
                  {checked && <Src f={f} />}
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <h2 className="label">{right}</h2>
          <ul className="stack">
            {st.answers.map((id) => (
              <li key={id}>
                <button className={`match-item ${used.has(id) ? "used" : ""}`} disabled={!active || checked} onClick={() => choose(id)}>
                  {byId.get(id)?.answer}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {checked && (
        <p className="strong mt" role="status">
          {score}/{st.round.length} matched correctly
        </p>
      )}
      <div className="row mt">
        {checked ? (
          <button className="btn btn-primary" onClick={() => { setSt(fresh()); setPairs({}); setChecked(false); setActive(null); }}>
            New round
          </button>
        ) : (
          <>
            <button className="btn btn-primary" disabled={!Object.keys(pairs).length} onClick={() => setChecked(true)}>
              Check matches
            </button>
            {Object.keys(pairs).length > 0 && (
              <button className="btn" onClick={() => setPairs({})}>
                Reset
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Compare({ groups }: { groups: ComparisonGroup[] }) {
  const [deck, setDeck] = useState(() => shuffle(groups));
  const [i, setI] = useState(0);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const [score, setScore] = useState({ right: 0, done: 0 });
  const g = deck.length ? deck[i % deck.length] : null;
  const answers = useMemo(() => (g ? shuffle(g.facts.map((f) => f.answer)) : []), [g]);
  if (!g) return <Empty what="easily confused facts" />;
  const allRight = g.facts.every((f) => picks[f.questionId] === f.answer);
  return (
    <div className="panel">
      <div className="row between">
        <span className="chip static">{g.reason}</span>
        <span className="tiny muted num">
          {score.right}/{score.done} pairs right
        </span>
      </div>
      <p className="small muted">These are easy to confuse. Give each question its answer.</p>
      <ul className="stack">
        {g.facts.map((f) => {
          const ok = picks[f.questionId] === f.answer;
          return (
            <li key={f.questionId} className={`drill-item col ${checked ? (ok ? "good" : "bad") : ""}`}>
              <p className="small strong">{f.prompt}</p>
              <div className="chips" role="radiogroup" aria-label={`Answer for: ${f.prompt}`}>
                {answers.map((a) => (
                  <button key={a} role="radio" aria-checked={picks[f.questionId] === a} disabled={checked} className={`chip ${picks[f.questionId] === a ? "on" : ""}`} onClick={() => setPicks({ ...picks, [f.questionId]: a })}>
                    {a}
                  </button>
                ))}
              </div>
              {checked && !ok && (
                <p className="small">
                  Answer: <strong>{f.answer}</strong>
                </p>
              )}
              <Src f={f} />
            </li>
          );
        })}
      </ul>
      <div className="mt">
        {checked ? (
          <button
            className="btn btn-primary"
            onClick={() => {
              if ((i + 1) % deck.length === 0) setDeck(shuffle(groups));
              setI(i + 1);
              setPicks({});
              setChecked(false);
            }}
          >
            Next pair
          </button>
        ) : (
          <button
            className="btn btn-primary"
            disabled={Object.keys(picks).length < g.facts.length}
            onClick={() => {
              setChecked(true);
              setScore((s) => ({ right: s.right + (allRight ? 1 : 0), done: s.done + 1 }));
            }}
          >
            Check
          </button>
        )}
      </div>
    </div>
  );
}

const GRADES = [
  { label: "Again", ok: false, conf: null, cls: "bad-outline" },
  { label: "Hard", ok: true, conf: 1, cls: "" },
  { label: "Good", ok: true, conf: 2, cls: "" },
  { label: "Easy", ok: true, conf: 3, cls: "good-outline" },
] as const;

function Flashcards() {
  const { store } = useApp();
  const cards = useMemo(
    () => store.allQuestions().map((q) => ({ id: q.id, prompt: q.prompt, answer: answerOf(q), ref: ref(q), cats: q.cats.map((c) => c.slug) })),
    [store],
  );
  const [cat, setCat] = useState("");
  const [deck, setDeck] = useState(() => shuffle(cards));
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [tally, setTally] = useState({ known: 0, again: 0 });
  const used = CATEGORIES.filter((c) => cards.some((x) => x.cats.includes(c.slug)));
  function changeDeck(slug: string) {
    setCat(slug);
    setDeck(shuffle(slug ? cards.filter((c) => c.cats.includes(slug)) : cards));
    setI(0);
    setFlipped(false);
  }
  const done = i >= deck.length;
  const card = deck[Math.min(i, deck.length - 1)];
  function grade(g: (typeof GRADES)[number]) {
    recall(store, card.id, "flashcards", g.ok, g.conf);
    setTally((t) => (g.ok ? { ...t, known: t.known + 1 } : { ...t, again: t.again + 1 }));
    if (!g.ok) setDeck((d) => [...d, card]); // "Again" cards come back at the end of this deck
    setI(i + 1);
    setFlipped(false);
  }
  return (
    <div>
      <div className="row wrap mb">
        <label htmlFor="fcdeck" className="small muted">
          Deck
        </label>
        <select id="fcdeck" className="auto" value={cat} onChange={(e) => changeDeck(e.target.value)}>
          <option value="">All questions ({cards.length})</option>
          {used.map((c) => (
            <option key={c.slug} value={c.slug}>
              {c.name}
            </option>
          ))}
        </select>
        <span className="tiny muted num push">
          {Math.min(i, deck.length)}/{deck.length} · {tally.known} known · {tally.again} again
        </span>
      </div>
      {!deck.length ? (
        <Empty what="cards in this category" />
      ) : done ? (
        <div className="panel center">
          <p className="strong">Deck finished</p>
          <p className="small muted">
            {tally.known} known, {tally.again} to repeat. Ratings were saved to your revision schedule.
          </p>
          <button className="btn btn-primary" onClick={() => changeDeck(cat)}>
            Shuffle and restart
          </button>
        </div>
      ) : (
        <div className="qcard">
          <button className={`flash ${flipped ? "back" : ""}`} onClick={() => setFlipped(!flipped)} aria-label={flipped ? "Show question" : "Show answer"}>
            <span className="eyebrow">{flipped ? "Answer" : "Question"}</span>
            <span className={flipped ? "flash-answer" : "flash-q"}>{flipped ? card.answer : card.prompt}</span>
            {flipped ? <span className="small muted">{card.prompt}</span> : <span className="tiny muted">Tap to flip</span>}
          </button>
          <p className="tiny muted mt">{card.ref}</p>
          {flipped && (
            <div className="grades" aria-label="How well did you recall it?">
              {GRADES.map((g) => (
                <button key={g.label} className={`btn ${g.cls}`} onClick={() => grade(g)}>
                  {g.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
