import * as React from "react";
import { useState } from "react";
import { categorise, deriveTopics } from "../../../src/lib/categorize";
import type { ReviewStatus } from "../../../src/lib/srs";
import { CAT_NAME, CATEGORIES, newId, type Flag, type Option, type Question } from "../model";
import { answerOf, catSlugs, derive, deriveAll, fmt, ref, type Derived } from "../logic";
import { contentHash } from "../store";
import { ConfirmButton, PageHeader, Panel, StatusPill, useApp } from "../ui";

interface Filters {
  q: string;
  cat: string;
  topic: string;
  exam: string;
  batch: string;
  status: string;
  difficulty: string;
  type: string;
  mark: string;
  sort: string;
}
const EMPTY: Filters = { q: "", cat: "", topic: "", exam: "", batch: "", status: "", difficulty: "", type: "", mark: "", sort: "source" };
let pending: Partial<Filters> | null = null;
/** Lets other screens open the bank pre-filtered by values that cannot go in a link (e.g. topic names). */
export function setBankFilter(f: Partial<Filters>) {
  pending = f;
}

const PAGE = 50;

function matches(d: Derived, f: Filters) {
  const q = d.q;
  if (f.q) {
    const needle = f.q.toLowerCase();
    const hay = [q.prompt, q.explanation, q.notes, q.aid, ...q.options.map((o) => o.text), ...q.topics].join(" ").toLowerCase();
    if (!hay.includes(needle)) return false;
  }
  if (f.cat && !catSlugs(q).includes(f.cat)) return false;
  if (f.topic && !q.topics.includes(f.topic)) return false;
  if (f.exam === "none" ? q.exam !== null : f.exam && q.exam !== Number(f.exam)) return false;
  if (f.batch && q.batchId !== f.batch) return false;
  if (f.status && d.state.status !== f.status) return false;
  if (f.difficulty && d.difficulty !== f.difficulty) return false;
  if (f.type && q.type !== f.type) return false;
  if (f.mark === "important" && !q.important) return false;
  if (f.mark === "confusing" && !q.confusing) return false;
  if (f.mark === "flagged" && !q.flags.some((x) => !x.resolvedAt)) return false;
  if (f.mark === "edited" && !q.editedAt) return false;
  if (f.mark === "mock_incorrect" && q.sourceResult !== "incorrect") return false;
  return true;
}

const missRate = (d: Derived) => (d.wrong + (d.q.sourceResult === "incorrect" ? 1 : 0)) / Math.max(1, d.n + (d.q.sourceResult ? 1 : 0));
const SORTS: Record<string, (a: Derived, b: Derived) => number> = {
  source: (a, b) => (a.q.exam ?? 9999) - (b.q.exam ?? 9999) || (a.q.qnum ?? 9999) - (b.q.qnum ?? 9999) || a.q.seq - b.q.seq,
  hardest: (a, b) => missRate(b) - missRate(a) || b.wrong - a.wrong,
  most: (a, b) => b.n - a.n,
  due: (a, b) => (a.state.dueAt?.getTime() ?? Infinity) - (b.state.dueAt?.getTime() ?? Infinity),
  newest: (a, b) => b.q.seq - a.q.seq,
  alpha: (a, b) => a.q.prompt.localeCompare(b.q.prompt),
};

function Sel({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">All</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

export function Bank({ initial }: { initial: string | null }) {
  const { store, go } = useApp();
  const [f, setF] = useState<Filters>(() => {
    const base = { ...EMPTY };
    if (pending) {
      Object.assign(base, pending);
      pending = null;
    } else if (initial) {
      const [k, v] = initial.split(".");
      if (k in base && v) (base as unknown as Record<string, string>)[k] = v;
    }
    return base;
  });
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<string[]>([]);
  const [assignTo, setAssignTo] = useState("");
  const [splitSize, setSplitSize] = useState("25");
  const [splitStart, setSplitStart] = useState("1");
  const [msg, setMsg] = useState<string | null>(null);
  const set = (k: keyof Filters) => (v: string) => {
    setF({ ...f, [k]: v });
    setPage(1);
    setPicked([]);
  };

  const all = deriveAll(store);
  const rows = all.filter((d) => matches(d, f)).sort(SORTS[f.sort] ?? SORTS.source);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const topics = [...new Set(all.flatMap((d) => d.q.topics))].sort();
  const exams = [...new Set(all.map((d) => d.q.exam))].sort((a, b) => (a ?? 9999) - (b ?? 9999));
  const active = Object.entries(f).filter(([k, v]) => k !== "sort" && v).length;
  const unassigned = all.filter((d) => !d.q.exam).map((d) => d.q).sort((a, b) => a.seq - b.seq);

  /** Assigns questions to an exam and numbers them in their original document order. */
  async function assign(ids: string[], exam: number | null) {
    const qs = ids.map((id) => store.questions.get(id)!).sort((a, b) => a.seq - b.seq);
    await store.putQuestions(qs.map((q, i) => ({ ...q, exam, qnum: exam ? i + 1 : null })));
  }
  async function bulkAssign() {
    await assign(picked, assignTo === "none" ? null : Number(assignTo));
    setMsg(`Updated ${picked.length} question${picked.length === 1 ? "" : "s"}. Numbers follow the original document order.`);
    setPicked([]);
  }
  async function splitUnassigned() {
    const size = Math.max(1, Number(splitSize) || 24);
    const start = Math.max(1, Number(splitStart) || 1);
    const updated: Question[] = unassigned.map((q, i) => ({ ...q, exam: start + Math.floor(i / size), qnum: (i % size) + 1 }));
    await store.putQuestions(updated);
    setMsg(`Assigned ${updated.length} questions to mock tests ${start}–${start + Math.ceil(updated.length / size) - 1}.`);
  }

  return (
    <>
      <PageHeader
        title="Question bank"
        sub={`${rows.length} question${rows.length === 1 ? "" : "s"}${active ? " match your filters" : ""}. Original mock exam and question numbers are kept.`}
        actions={
          <button className="btn" onClick={() => go("newq")}>
            Add question
          </button>
        }
      />
      {unassigned.length > 0 && (
        <div className="panel notice">
          <p className="small">
            <strong>{unassigned.length} questions are not assigned to a mock exam.</strong> Your document had no “Mock test N” headings, so where each test starts is unknown.
            Split them in document order, or tick questions below and assign them.
          </p>
          <div className="row wrap">
            <label className="small row" htmlFor="ssize">
              Every
              <input id="ssize" className="num-input" inputMode="numeric" value={splitSize} onChange={(e) => setSplitSize(e.target.value)} />
              questions is a new mock test, starting at mock
              <input id="sstart" aria-label="First mock test number" className="num-input" inputMode="numeric" value={splitStart} onChange={(e) => setSplitStart(e.target.value)} />
            </label>
            <ConfirmButton
              small
              label="Split"
              confirmLabel={`Mock ${Number(splitStart) || 1}: #1–${Math.min(unassigned.length, Number(splitSize) || 24)}${unassigned.length > (Number(splitSize) || 24) ? ", …" : ""}. Apply?`}
              onConfirm={splitUnassigned}
            />
          </div>
        </div>
      )}
      <div className="panel filters" role="search">
        <div className="field span2">
          <label htmlFor="fq">Search</label>
          <input id="fq" value={f.q} placeholder="Words in the question, answers, notes or topics" onChange={(e) => set("q")(e.target.value)} />
        </div>
        <Sel id="fcat" label="Category" value={f.cat} onChange={set("cat")} options={CATEGORIES.map((c) => [c.slug, c.name])} />
        <Sel id="ftopic" label="Topic" value={f.topic} onChange={set("topic")} options={topics.map((t) => [t, t])} />
        <Sel id="fexam" label="Mock exam" value={f.exam} onChange={set("exam")} options={exams.map((e) => [e === null ? "none" : String(e), e === null ? "Not assigned" : `Mock ${e}`])} />
        <Sel id="fbatch" label="Imported batch" value={f.batch} onChange={set("batch")} options={[...store.batches.values()].map((b) => [b.id, b.label ?? b.filename])} />
        <Sel id="fstatus" label="Revision status" value={f.status} onChange={set("status")} options={[["new", "New"], ["learning", "Learning"], ["needs_revision", "Needs revision"], ["mastered", "Mastered"]]} />
        <Sel id="fdiff" label="Difficulty (personal)" value={f.difficulty} onChange={set("difficulty")} options={[["hard", "Hard"], ["medium", "Medium"], ["easy", "Easy"], ["unrated", "Unrated"]]} />
        <Sel id="ftype" label="Question type" value={f.type} onChange={set("type")} options={[["single", "Single answer"], ["multi", "Multiple answers"], ["true_false", "True / false"]]} />
        <Sel
          id="fmark"
          label="Marked"
          value={f.mark}
          onChange={set("mark")}
          options={[["important", "Important"], ["confusing", "Confusing"], ["flagged", "Flagged"], ["edited", "Edited"], ["mock_incorrect", "Wrong in mock test"]]}
        />
        <div className="field">
          <label htmlFor="fsort">Sort by</label>
          <select id="fsort" value={f.sort} onChange={(e) => set("sort")(e.target.value)}>
            <option value="source">Mock exam &amp; question number</option>
            <option value="hardest">Hardest for me</option>
            <option value="most">Most practised</option>
            <option value="due">Next review due</option>
            <option value="newest">Recently imported</option>
            <option value="alpha">Alphabetical</option>
          </select>
        </div>
        <div className="field end">
          {active > 0 && (
            <button className="btn" onClick={() => { setF({ ...EMPTY, sort: f.sort }); setPage(1); }}>
              Clear filters
            </button>
          )}
        </div>
      </div>

      <div className="panel bulk">
        <label className="row small">
          <input type="checkbox" checked={shown.length > 0 && shown.every((d) => picked.includes(d.q.id))} onChange={(e) => setPicked(e.target.checked ? shown.map((d) => d.q.id) : [])} />
          Select all on page
        </label>
        <span className="small muted">{picked.length} selected</span>
        <div className="row wrap push">
          <label htmlFor="assign" className="small muted">
            Assign to
          </label>
          <select id="assign" className="auto" value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>
            <option value="">Mock exam…</option>
            {Array.from({ length: 40 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                Mock {n}
              </option>
            ))}
            <option value="none">Not assigned</option>
          </select>
          <button className="btn btn-sm" disabled={!picked.length || !assignTo} onClick={bulkAssign}>
            Apply
          </button>
        </div>
        {msg && (
          <p className="tiny muted full" role="status">
            {msg}
          </p>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="panel center muted">No questions match. Try clearing a filter.</div>
      ) : (
        <ul className="stack">
          {shown.map((d) => {
            const q = d.q;
            const on = picked.includes(q.id);
            return (
              <li key={q.id} className={`qrow ${on ? "picked" : ""}`}>
                <input type="checkbox" aria-label={`Select: ${q.prompt}`} checked={on} onChange={() => setPicked(on ? picked.filter((x) => x !== q.id) : [...picked, q.id])} />
                <div className="minw0 grow">
                  <div className="chips">
                    <span className="chip static strong">{ref(q)}</span>
                    <StatusPill status={d.state.status as ReviewStatus} />
                    {q.sourceResult === "incorrect" && <span className="chip static bad">Wrong in mock</span>}
                    {q.important && <span className="chip static warn">Important</span>}
                    {q.confusing && <span className="chip static">Confusing</span>}
                    {q.flags.some((x) => !x.resolvedAt) && <span className="chip static bad">Flagged</span>}
                    {q.editedAt && <span className="chip static">Edited</span>}
                  </div>
                  <button className="linkbtn strong left" onClick={() => go("q", q.id)}>
                    {q.prompt}
                  </button>
                  <p className="small">
                    <span className="muted">Answer: </span>
                    {answerOf(q)}
                  </p>
                  <p className="tiny muted">
                    {q.cats.map((c) => CAT_NAME[c.slug]).join(", ")} · {d.n} attempt{d.n === 1 ? "" : "s"}
                    {d.n ? `, ${d.n - d.wrong} correct` : ""} · <span className={`diff-${d.difficulty}`}>{d.difficulty === "unrated" ? "Unrated" : d.difficulty[0].toUpperCase() + d.difficulty.slice(1)}</span>
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {pages > 1 && (
        <nav className="row center mt" aria-label="Pages">
          <button className="btn btn-sm" disabled={page === 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="small muted">
            Page {page} of {pages}
          </span>
          <button className="btn btn-sm" disabled={page === pages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </nav>
      )}
    </>
  );
}

// ------------------------------------------------------------------ flag button

export function FlagButton({ q }: { q: Question }) {
  const { store } = useApp();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Flag["reason"]>("possible_error");
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  if (done) return <span className="tiny muted">Flagged.</span>;
  async function save() {
    const cur = store.questions.get(q.id)!;
    await store.putQuestion({
      ...cur,
      confusing: cur.confusing || reason === "confusing",
      flags: [...cur.flags, { id: newId(), reason, note: note.trim() || null, at: new Date().toISOString(), resolvedAt: null }],
    });
    setDone(true);
    setOpen(false);
  }
  return (
    <div className="pop-wrap">
      <button className="btn btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}>
        Flag
      </button>
      {open && (
        <div className="pop">
          <label htmlFor={`fr-${q.id}`} className="tiny muted">
            What is wrong?
          </label>
          <select id={`fr-${q.id}`} value={reason} onChange={(e) => setReason(e.target.value as Flag["reason"])}>
            <option value="possible_error">Possible error in the source</option>
            <option value="confusing">Confusing / easy to mix up</option>
            <option value="duplicate">Duplicate of another question</option>
            <option value="other">Other</option>
          </select>
          <textarea aria-label="Note" placeholder="Optional note" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} />
          <div className="row end">
            <button className="btn btn-sm" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn btn-sm btn-primary" onClick={save}>
              Save flag
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ detail / editor

const KEYS = "ABCDEFGHIJ";

export function QuestionView({ id }: { id: string }) {
  const { store, go } = useApp();
  const existing = id ? store.questions.get(id) : undefined;
  if (id && !existing) {
    return (
      <div className="panel narrow">
        <h1 className="h2">Question not found</h1>
        <p className="muted">It may have been deleted.</p>
        <button className="btn" onClick={() => go("bank")}>
          Back to the question bank
        </button>
      </div>
    );
  }
  const d = existing ? derive(existing, store.attemptsOf(existing.id)) : null;
  return (
    <>
      <div className="row wrap small mb">
        <button className="linkbtn" onClick={() => go("bank")}>
          ← Question bank
        </button>
        {existing && (
          <>
            <span className="chip static">{ref(existing)}</span>
            {existing.pos && <span className="chip static">Position {existing.pos} in source document</span>}
            {d && <StatusPill status={d.state.status} />}
            <span className="push">
              <FlagButton q={existing} />
            </span>
          </>
        )}
      </div>
      {existing && d ? (
        <div className="grid-detail">
          <Panel title={existing.editedAt ? "Edit question (edited)" : "Edit question"}>
            <Editor q={existing} />
          </Panel>
          <div className="stack">
            <Panel title="Your progress">
              <dl className="dl">
                <dt>Attempts</dt>
                <dd>
                  {d.n} ({d.n - d.wrong} correct)
                </dd>
                <dt>Mock test result</dt>
                <dd>{existing.sourceResult ?? "—"}</dd>
                <dt>Difficulty</dt>
                <dd>{d.difficulty}</dd>
                <dt>Correct in a row</dt>
                <dd>{d.state.correctStreak}</dd>
                <dt>Times forgotten</dt>
                <dd>{d.state.lapses}</dd>
                <dt>Next review</dt>
                <dd>{d.n && d.state.dueAt ? fmt(d.state.dueAt.toISOString()) : "Not scheduled"}</dd>
              </dl>
              {d.attempts.length > 0 && (
                <ul className="history">
                  {[...d.attempts].reverse().slice(0, 40).map((a, i) => (
                    <li key={a.at + i}>
                      <span className={a.ok ? "good-text" : "bad-text"}>{a.ok ? "✓ Correct" : "✗ Incorrect"}</span>
                      <span className="muted">
                        {a.mode} · {fmt(a.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            {existing.flags.length > 0 && (
              <Panel title="Flags">
                <ul className="stack">
                  {existing.flags.map((fl) => (
                    <li key={fl.id} className="flag">
                      <div className="row between">
                        <span className="strong small">{fl.reason.replace("_", " ")}</span>
                        {fl.resolvedAt ? (
                          <span className="tiny good-text">Resolved</span>
                        ) : (
                          <button
                            className="btn btn-sm"
                            onClick={() =>
                              store.putQuestion({ ...existing, flags: existing.flags.map((x) => (x.id === fl.id ? { ...x, resolvedAt: new Date().toISOString() } : x)) })
                            }
                          >
                            Mark resolved
                          </button>
                        )}
                      </div>
                      {fl.note && <p className="small muted">{fl.note}</p>}
                      <p className="tiny muted">{fmt(fl.at)}</p>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
            {existing.original && (
              <Panel title="Original (as imported)">
                <p className="strong small">{existing.original.prompt}</p>
                <ul className="orig">
                  {existing.original.options.map((o) => (
                    <li key={o.key} className={existing.original!.correctKeys.includes(o.key) ? "good-text strong" : "muted"}>
                      {existing.original!.correctKeys.includes(o.key) ? "✓ " : "• "}
                      {o.text}
                    </li>
                  ))}
                </ul>
                {existing.original.rawResult && <p className="tiny muted">Marked in document: {existing.original.rawResult}</p>}
                {existing.original.explanation && <p className="tiny muted">{existing.original.explanation}</p>}
                {existing.editedAt && <p className="notice-inline tiny">Edited. Current answer: {answerOf(existing)}</p>}
                {existing.batchId && store.batches.get(existing.batchId) && (
                  <p className="tiny muted">
                    Imported from {store.batches.get(existing.batchId)!.filename} on {fmt(store.batches.get(existing.batchId)!.createdAt)}
                  </p>
                )}
              </Panel>
            )}
            <div className="row wrap">
              {existing.editedAt && existing.original && (
                <ConfirmButton
                  small
                  label="Restore original"
                  confirmLabel="Restore the imported wording and answer?"
                  onConfirm={async () => {
                    const o = existing.original!;
                    await saveQuestion(store, existing, { ...existing, prompt: o.prompt, options: o.options, correctKeys: o.correctKeys, explanation: o.explanation }, true);
                  }}
                />
              )}
              <ConfirmButton
                small
                danger
                label="Delete question"
                confirmLabel="Delete it and its practice history?"
                onConfirm={async () => {
                  await store.deleteQuestion(existing.id);
                  go("bank");
                }}
              />
            </div>
          </div>
        </div>
      ) : (
        <>
          <PageHeader title="Add a question" sub="Manually added questions work exactly like imported ones." />
          <Panel>
            <Editor />
          </Panel>
        </>
      )}
    </>
  );
}

async function saveQuestion(store: ReturnType<typeof useApp>["store"], before: Question, after: Question, restoring = false) {
  const contentChanged =
    before.prompt !== after.prompt ||
    JSON.stringify(before.options) !== JSON.stringify(after.options) ||
    JSON.stringify([...before.correctKeys].sort()) !== JSON.stringify([...after.correctKeys].sort()) ||
    (before.explanation ?? null) !== (after.explanation ?? null);
  const tf = after.options.length === 2 && after.options.every((o) => /^(true|false)$/i.test(o.text.trim().replace(/[.!]$/, "")));
  const next: Question = {
    ...after,
    type: tf ? "true_false" : after.correctKeys.length > 1 ? "multi" : "single",
    hash: contentHash(after.prompt, after.options),
    editedAt: restoring ? null : contentChanged ? new Date().toISOString() : before.editedAt,
  };
  await store.putQuestion(next);
  // Past answers were graded against the old answer: regrade them so progress stays accurate.
  if (JSON.stringify([...before.correctKeys].sort()) !== JSON.stringify([...after.correctKeys].sort())) {
    const sorted = [...after.correctKeys].sort().join();
    const regraded = store.attemptsOf(before.id).map((a) => (a.self ? a : { ...a, ok: [...a.sel].sort().join() === sorted }));
    await store.setAttempts(before.id, regraded);
  }
}

function Editor({ q }: { q?: Question }) {
  const { store, go } = useApp();
  const [prompt, setPrompt] = useState(q?.prompt ?? "");
  const [options, setOptions] = useState<Option[]>(q?.options ?? ["A", "B", "C", "D"].map((key) => ({ key, text: "" })));
  const [correct, setCorrect] = useState<string[]>(q?.correctKeys ?? []);
  const [explanation, setExplanation] = useState(q?.explanation ?? "");
  const [exam, setExam] = useState(q?.exam?.toString() ?? "");
  const [qnum, setQnum] = useState(q?.qnum?.toString() ?? "");
  const [cats, setCats] = useState<string[]>(q?.cats.map((c) => c.slug) ?? []);
  const [topics, setTopics] = useState(q?.topics.join(", ") ?? "");
  const [notes, setNotes] = useState(q?.notes ?? "");
  const [aid, setAid] = useState(q?.aid ?? "");
  const [important, setImportant] = useState(q?.important ?? false);
  const [confusing, setConfusing] = useState(q?.confusing ?? false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const opts = options.map((o) => ({ ...o, text: o.text.trim() })).filter((o) => o.text);
    const keys = correct.filter((k) => opts.some((o) => o.key === k));
    if (prompt.trim().length < 3) return setMsg({ ok: false, text: "Write the question first." });
    if (opts.length < 2) return setMsg({ ok: false, text: "Add at least two options." });
    if (!keys.length) return setMsg({ ok: false, text: "Tick the correct answer." });
    if (keys.length >= opts.length) return setMsg({ ok: false, text: "At least one option must be wrong." });
    const hash = contentHash(prompt, opts);
    const dup = store.allQuestions().find((x) => x.hash === hash && x.id !== q?.id);
    if (dup) return setMsg({ ok: false, text: `An identical question already exists (${ref(dup)}).` });
    const examN = exam ? Math.min(200, Math.max(1, Number(exam))) : null;
    const qn = qnum ? Math.max(1, Number(qnum)) : null;
    const topicList = topics.split(",").map((t) => t.trim()).filter(Boolean);
    const base = { prompt: prompt.trim(), options: opts, correctKeys: [...keys].sort(), explanation: explanation.trim() || null };
    const manualCats = (cs: string[]) => cs.map((slug) => ({ slug, source: "manual" as const }));
    if (q) {
      const catsChanged = [...cats].sort().join() !== q.cats.map((c) => c.slug).sort().join();
      await saveQuestion(store, q, {
        ...q,
        ...base,
        exam: examN,
        qnum: qn,
        cats: catsChanged ? manualCats(cats) : q.cats,
        topics: topicList,
        notes: notes.trim() || null,
        aid: aid.trim() || null,
        important,
        confusing,
      });
      setMsg({ ok: true, text: "Saved. The original imported version is kept for reference." });
    } else {
      const now = new Date().toISOString();
      const nq: Question = {
        id: newId(),
        seq: store.nextSeq(),
        pos: null,
        ...base,
        type: "single",
        exam: examN,
        qnum: qn,
        sourceResult: null,
        original: { ...base, exam: examN, qnum: qn },
        hash,
        topics: topicList.length ? topicList : deriveTopics(base),
        cats: cats.length ? manualCats(cats) : categorise(base).map((slug) => ({ slug, source: "auto" as const })),
        notes: notes.trim() || null,
        aid: aid.trim() || null,
        important,
        confusing,
        flags: [],
        batchId: null,
        createdAt: now,
        editedAt: null,
      };
      await saveQuestion(store, nq, nq);
      go("q", nq.id);
    }
  }

  return (
    <form onSubmit={save} className="form">
      <div className="field">
        <label htmlFor="eprompt">Question</label>
        <textarea id="eprompt" value={prompt} maxLength={1000} onChange={(e) => setPrompt(e.target.value)} />
      </div>
      <fieldset className="field">
        <legend>Options: tick the correct answer(s)</legend>
        {options.map((o, i) => (
          <div key={o.key} className="row opt-edit">
            <input type="checkbox" aria-label={`Option ${o.key} is correct`} checked={correct.includes(o.key)} onChange={() => setCorrect(correct.includes(o.key) ? correct.filter((k) => k !== o.key) : [...correct, o.key])} />
            <input aria-label={`Option ${o.key}`} value={o.text} maxLength={500} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
            <button
              type="button"
              className="btn btn-sm"
              aria-label={`Remove option ${o.key}`}
              disabled={options.length <= 2}
              onClick={() => {
                setOptions(options.filter((_, j) => j !== i));
                setCorrect(correct.filter((k) => k !== o.key));
              }}
            >
              ✕
            </button>
          </div>
        ))}
        {options.length < 10 && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              const used = new Set(options.map((o) => o.key));
              setOptions([...options, { key: [...KEYS].find((k) => !used.has(k)) ?? String(options.length + 1), text: "" }]);
            }}
          >
            Add option
          </button>
        )}
      </fieldset>
      <div className="field">
        <label htmlFor="eexp">Explanation</label>
        <textarea id="eexp" value={explanation} maxLength={5000} onChange={(e) => setExplanation(e.target.value)} />
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="eexam">Mock exam number</label>
          <input id="eexam" inputMode="numeric" value={exam} onChange={(e) => setExam(e.target.value.replace(/\D/g, ""))} />
        </div>
        <div className="field">
          <label htmlFor="eqnum">Question number</label>
          <input id="eqnum" inputMode="numeric" value={qnum} onChange={(e) => setQnum(e.target.value.replace(/\D/g, ""))} />
        </div>
      </div>
      <fieldset className="field">
        <legend>Categories {q ? "(changing these marks them as set by you)" : "(leave empty to categorise automatically)"}</legend>
        <div className="chips">
          {CATEGORIES.filter((c) => c.slug !== "uncategorised").map((c) => {
            const on = cats.includes(c.slug);
            return (
              <button type="button" key={c.slug} aria-pressed={on} className={`chip ${on ? "on" : ""}`} onClick={() => setCats(on ? cats.filter((x) => x !== c.slug) : [...cats, c.slug])}>
                {c.name}
              </button>
            );
          })}
        </div>
      </fieldset>
      <div className="field">
        <label htmlFor="etopics">Topics (comma separated)</label>
        <input id="etopics" value={topics} onChange={(e) => setTopics(e.target.value)} placeholder={q ? "" : "Leave empty to detect automatically"} />
      </div>
      <div className="grid2">
        <div className="field">
          <label htmlFor="eaid">Memory aid</label>
          <textarea id="eaid" value={aid} maxLength={2000} placeholder="e.g. 1455 → 1485: thirty years of roses" onChange={(e) => setAid(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="enotes">Notes</label>
          <textarea id="enotes" value={notes} maxLength={5000} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>
      <div className="row wrap small">
        <label className="row">
          <input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} /> Important
        </label>
        <label className="row">
          <input type="checkbox" checked={confusing} onChange={(e) => setConfusing(e.target.checked)} /> Confusing
        </label>
      </div>
      {msg && (
        <p className={msg.ok ? "ok" : "err"} role="status">
          {msg.text}
        </p>
      )}
      <div>
        <button className="btn btn-primary">{q ? "Save changes" : "Add question"}</button>
      </div>
    </form>
  );
}
