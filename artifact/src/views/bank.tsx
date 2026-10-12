import * as React from "react";
import { useState } from "react";
import { categorise, deriveTopics } from "../../../src/lib/categorize";
import { CAT_NAME, CATEGORIES, STYLES, newId, placement, type Flag, type Option, type Question } from "../model";
import { answerOf, catSlugs, derive, deriveAll, fmt, ref, stylesOf, type Derived } from "../logic";
import { contentHash } from "../store";
import { generateTips, sampleErrorText } from "../tips";
import { ConfirmButton, PageHeader, Panel, StatusPill, TipBox, useApp } from "../ui";

interface Filters {
  q: string;
  test: string;
  cat: string;
  style: string;
  status: string;
  mark: string;
  sort: string;
}
const EMPTY: Filters = { q: "", test: "", cat: "", style: "", status: "", mark: "", sort: "source" };
let pending: Partial<Filters> | null = null;
/** Lets other screens open the bank pre-filtered by values that cannot go in a link. */
export function setBankFilter(f: Partial<Filters>) {
  pending = f;
}
const PAGE = 50;

function matches(d: Derived, f: Filters) {
  const q = d.q;
  if (f.q) {
    const hay = [q.prompt, q.explanation, q.notes, q.aid, ...q.options.map((o) => o.text), ...q.topics, ...(q.tips ?? [])].join(" ").toLowerCase();
    if (!hay.includes(f.q.toLowerCase())) return false;
  }
  if (f.test === "none" ? q.exam !== null : f.test && q.exam !== Number(f.test)) return false;
  if (f.cat && !catSlugs(q).includes(f.cat)) return false;
  if (f.style && !stylesOf(q).includes(f.style)) return false;
  if (f.status && d.status !== f.status) return false;
  if (f.mark === "flagged" && !q.flags.some((x) => !x.resolvedAt)) return false;
  if (f.mark === "notips" && (q.tips ?? []).length) return false;
  if (f.mark === "edited" && !q.editedAt) return false;
  if (f.mark === "important" && !q.important) return false;
  return true;
}
const SORTS: Record<string, (a: Derived, b: Derived) => number> = {
  source: (a, b) => (a.q.exam ?? 9999) - (b.q.exam ?? 9999) || (a.q.qnum ?? 9999) - (b.q.qnum ?? 9999) || a.q.seq - b.q.seq,
  missed: (a, b) => b.wrong - a.wrong || b.n - a.n,
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
  const { store, go, sample } = useApp();
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
  const [tipJob, setTipJob] = useState<{ done: number; total: number; error?: string } | null>(null);
  const set = (k: keyof Filters) => (v: string) => {
    setF({ ...f, [k]: v });
    setPage(1);
  };
  const all = deriveAll(store);
  const rows = all.filter((d) => matches(d, f)).sort(SORTS[f.sort] ?? SORTS.source);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const shown = rows.slice((page - 1) * PAGE, page * PAGE);
  const tests = [...new Set(all.map((d) => d.q.exam))].sort((a, b) => (a ?? 9999) - (b ?? 9999));
  const active = Object.entries(f).filter(([k, v]) => k !== "sort" && v).length;
  const noTips = all.filter((d) => !(d.q.tips ?? []).length).map((d) => d.q);
  const unplaced = all.filter((d) => !d.q.exam).map((d) => d.q);

  async function fillTips() {
    const todo = noTips.slice();
    setTipJob({ done: 0, total: todo.length });
    for (let i = 0; i < todo.length; i += 12) {
      const chunk = todo.slice(i, i + 12);
      try {
        const res = await generateTips(sample, chunk);
        const updated = chunk.filter((q) => res[q.id]).map((q) => ({ ...store.questions.get(q.id)!, tips: res[q.id] }));
        await store.putQuestions(updated);
        setTipJob({ done: Math.min(i + 12, todo.length), total: todo.length });
      } catch (e) {
        setTipJob({ done: i, total: todo.length, error: sampleErrorText(e) });
        return;
      }
    }
  }

  async function placeByOrder() {
    const qs = unplaced.map((q) => ({ ...q, ...(q.pos ? placement(q.pos) : {}) })).filter((q) => q.exam);
    await store.putQuestions(qs);
  }

  return (
    <>
      <PageHeader
        title="Questions"
        sub={`${rows.length} question${rows.length === 1 ? "" : "s"}${active ? " match your filters" : ""}.`}
        actions={
          store.isEditor && (
            <button className="btn" onClick={() => go("newq")}>
              Add question
            </button>
          )
        }
      />
      {store.isEditor && (noTips.length > 0 || unplaced.length > 0) && (
        <div className="panel notice">
          {noTips.length > 0 && (
            <div className="row wrap">
              <span className="small grow">
                <strong>{noTips.length} questions have no memory tip yet.</strong>{" "}
                {sample ? "Claude can write them (uses your Claude usage)." : "Open this page on claude.ai to have Claude write them."}
              </span>
              {sample && !tipJob && (
                <button className="btn btn-sm btn-primary" onClick={fillTips}>
                  Write {noTips.length} tips
                </button>
              )}
              {tipJob && (
                <span className="small" role="status">
                  {tipJob.error ?? (tipJob.done < tipJob.total ? `Writing tips… ${tipJob.done}/${tipJob.total}` : `Done: ${tipJob.total} tips written.`)}
                </span>
              )}
            </div>
          )}
          {unplaced.length > 0 && (
            <div className="row wrap">
              <span className="small grow">
                <strong>{unplaced.length} questions are not in a test.</strong> Place them by their document order (24 per test).
              </span>
              <ConfirmButton small label="Place them" confirmLabel="Assign tests by document order?" onConfirm={placeByOrder} />
            </div>
          )}
        </div>
      )}
      <div className="panel filters" role="search">
        <div className="field span2">
          <label htmlFor="fq">Search</label>
          <input id="fq" value={f.q} placeholder="Words in the question, answers, tips or topics" onChange={(e) => set("q")(e.target.value)} />
        </div>
        <Sel id="ftest" label="Test" value={f.test} onChange={set("test")} options={tests.map((e) => [e === null ? "none" : String(e), e === null ? "Not in a test" : `Test ${e}`])} />
        <Sel id="fstyle" label="Question style" value={f.style} onChange={set("style")} options={STYLES.map((s) => [s.key, s.name])} />
        <Sel id="fcat" label="Topic" value={f.cat} onChange={set("cat")} options={CATEGORIES.map((c) => [c.slug, c.name])} />
        <Sel id="fstatus" label="My status" value={f.status} onChange={set("status")} options={[["new", "Not answered"], ["missed", "To retry"], ["learned", "Got it"]]} />
        {store.isEditor && (
          <Sel id="fmark" label="Marked" value={f.mark} onChange={set("mark")} options={[["flagged", "Flagged"], ["notips", "No tip yet"], ["edited", "Edited"], ["important", "Important"]]} />
        )}
        <div className="field">
          <label htmlFor="fsort">Sort by</label>
          <select id="fsort" value={f.sort} onChange={(e) => set("sort")(e.target.value)}>
            <option value="source">Test &amp; question number</option>
            <option value="missed">Most missed by me</option>
            <option value="newest">Recently added</option>
            <option value="alpha">Alphabetical</option>
          </select>
        </div>
        {active > 0 && (
          <div className="field end">
            <button
              className="btn"
              onClick={() => {
                setF({ ...EMPTY, sort: f.sort });
                setPage(1);
              }}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <div className="panel center muted">No questions match. Try clearing a filter.</div>
      ) : (
        <ul className="stack">
          {shown.map((d) => {
            const q = d.q;
            return (
              <li key={q.id} className="qrow">
                <div className="minw0 grow">
                  <div className="chips">
                    <span className="chip static strong">{ref(q)}</span>
                    <StatusPill status={d.status} />
                    {stylesOf(q)
                      .filter((s) => ["truefalse", "multi", "not"].includes(s))
                      .map((s) => (
                        <span key={s} className="chip static">
                          {STYLES.find((x) => x.key === s)!.name}
                        </span>
                      ))}
                    {store.isEditor && q.flags.some((x) => !x.resolvedAt) && <span className="chip static bad">Flagged</span>}
                  </div>
                  <button className="linkbtn strong left" onClick={() => go("q", q.id)}>
                    {q.prompt}
                  </button>
                  <p className="small">
                    <span className="muted">Answer: </span>
                    {answerOf(q)}
                  </p>
                  <p className="tiny muted">
                    {q.cats.map((c) => CAT_NAME[c.slug]).join(", ")}
                    {d.n ? ` · answered ${d.n}×, wrong ${d.wrong}×` : ""}
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

// ------------------------------------------------------------------ flag button (editors)

export function FlagButton({ q }: { q: Question }) {
  const { store } = useApp();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<Flag["reason"]>("possible_error");
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  if (!store.isEditor) return null;
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

// ------------------------------------------------------------------ question page

export function QuestionView({ id }: { id: string }) {
  const { store, go } = useApp();
  const existing = id ? store.questions.get(id) : undefined;
  if (id && !existing) {
    return (
      <div className="panel narrow">
        <h1 className="h2">Question not found</h1>
        <button className="btn" onClick={() => go("bank")}>
          Back to questions
        </button>
      </div>
    );
  }
  if (!existing) {
    return store.isEditor ? (
      <>
        <PageHeader title="Add a question" sub="It is placed after the last question, in the next free test slot." />
        <Panel>
          <Editor />
        </Panel>
      </>
    ) : null;
  }
  const d = derive(existing, store.attemptsOf(existing.id));
  return (
    <>
      <div className="row wrap small mb">
        <button className="linkbtn" onClick={() => go("bank")}>
          ← Questions
        </button>
        <span className="chip static">{ref(existing)}</span>
        <StatusPill status={d.status} />
        <span className="push">
          <FlagButton q={existing} />
        </span>
      </div>
      <div className="grid-detail">
        <div className="stack">
          <Panel>
            <h1 className="h2">{existing.prompt}</h1>
            <ul className="orig">
              {existing.options.map((o) => (
                <li key={o.key} className={existing.correctKeys.includes(o.key) ? "good-text strong" : "muted"}>
                  {existing.correctKeys.includes(o.key) ? "✓ " : "• "}
                  {o.text}
                </li>
              ))}
            </ul>
            {existing.explanation && <p className="explain small">{existing.explanation}</p>}
            <TipBox q={existing} />
          </Panel>
          {store.isEditor && (
            <Panel title={existing.editedAt ? "Edit (edited)" : "Edit"}>
              <Editor q={existing} />
            </Panel>
          )}
        </div>
        <div className="stack">
          <Panel title="My answers">
            <p className="small">
              {d.n ? `Answered ${d.n}× · right ${d.n - d.wrong}× · wrong ${d.wrong}×` : "Not answered yet."}
            </p>
            {d.attempts.length > 0 && (
              <ul className="history">
                {[...d.attempts].reverse().slice(0, 40).map((a, i) => (
                  <li key={a.at + i}>
                    <span className={a.ok ? "good-text" : "bad-text"}>{a.ok ? "✓ Right" : "✗ Wrong"}</span>
                    <span className="muted">
                      {a.mode} · {fmt(a.at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {store.isEditor && existing.flags.length > 0 && (
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
                          onClick={() => store.putQuestion({ ...existing, flags: existing.flags.map((x) => (x.id === fl.id ? { ...x, resolvedAt: new Date().toISOString() } : x)) })}
                        >
                          Mark resolved
                        </button>
                      )}
                    </div>
                    {fl.note && <p className="small muted">{fl.note}</p>}
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          {store.isEditor && existing.original && existing.editedAt && (
            <Panel title="Original (as imported)">
              <p className="strong small">{existing.original.prompt}</p>
              <ul className="orig">
                {existing.original.options.map((o) => (
                  <li key={o.key} className={existing.original!.correctKeys.includes(o.key) ? "good-text strong" : "muted"}>
                    {o.text}
                  </li>
                ))}
              </ul>
              <ConfirmButton
                small
                label="Restore original"
                confirmLabel="Restore the imported wording and answer?"
                onConfirm={() => {
                  const o = existing.original!;
                  return saveQuestion(store, existing, { ...existing, prompt: o.prompt, options: o.options, correctKeys: o.correctKeys, explanation: o.explanation }, true);
                }}
              />
            </Panel>
          )}
          {store.isEditor && (
            <ConfirmButton
              small
              danger
              label="Delete question"
              confirmLabel="Delete it for everyone?"
              onConfirm={async () => {
                await store.deleteQuestion(existing.id);
                go("bank");
              }}
            />
          )}
        </div>
      </div>
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
  await store.putQuestion({
    ...after,
    type: tf ? "true_false" : after.correctKeys.length > 1 ? "multi" : "single",
    hash: contentHash(after.prompt, after.options),
    editedAt: restoring ? null : contentChanged ? new Date().toISOString() : before.editedAt,
  });
  if (JSON.stringify([...before.correctKeys].sort()) !== JSON.stringify([...after.correctKeys].sort())) {
    // My past answers were marked against the old answer: re-mark them so my progress stays accurate.
    const sorted = [...after.correctKeys].sort().join();
    await store.setAttempts(before.id, store.attemptsOf(before.id).map((a) => (a.self ? a : { ...a, ok: [...a.sel].sort().join() === sorted })));
  }
}

const KEYS = "ABCDEFGHIJ";

function Editor({ q }: { q?: Question }) {
  const { store, go } = useApp();
  const [prompt, setPrompt] = useState(q?.prompt ?? "");
  const [options, setOptions] = useState<Option[]>(q?.options ?? ["A", "B", "C", "D"].map((key) => ({ key, text: "" })));
  const [correct, setCorrect] = useState<string[]>(q?.correctKeys ?? []);
  const [explanation, setExplanation] = useState(q?.explanation ?? "");
  const [tips, setTips] = useState((q?.tips ?? []).join("\n"));
  const [aid, setAid] = useState(q?.aid ?? "");
  const [cats, setCats] = useState<string[]>(q?.cats.map((c) => c.slug) ?? []);
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
    const base = { prompt: prompt.trim(), options: opts, correctKeys: [...keys].sort(), explanation: explanation.trim() || null };
    const tipList = tips.split("\n").map((t) => t.trim()).filter(Boolean);
    const manual = (cs: string[]) => cs.map((slug) => ({ slug, source: "manual" as const }));
    if (q) {
      const catsChanged = [...cats].sort().join() !== q.cats.map((c) => c.slug).sort().join();
      await saveQuestion(store, q, { ...q, ...base, tips: tipList, aid: aid.trim() || null, cats: catsChanged ? manual(cats) : q.cats });
      setMsg({ ok: true, text: "Saved." });
    } else {
      const pos = store.maxPos() + 1;
      const now = new Date().toISOString();
      const nq: Question = {
        id: newId(),
        seq: pos,
        pos,
        ...base,
        type: "single",
        ...placement(pos),
        original: { ...base, ...placement(pos) },
        hash,
        topics: deriveTopics(base),
        cats: cats.length ? manual(cats) : categorise(base).map((slug) => ({ slug, source: "auto" as const })),
        tips: tipList,
        notes: null,
        aid: aid.trim() || null,
        important: false,
        confusing: false,
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
      <div className="field">
        <label htmlFor="etips">Memory tips (one per line, shown to everyone)</label>
        <textarea id="etips" value={tips} maxLength={3000} onChange={(e) => setTips(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="eaid">Owner’s note (shown first)</label>
        <input id="eaid" value={aid} maxLength={500} onChange={(e) => setAid(e.target.value)} />
      </div>
      <fieldset className="field">
        <legend>Topics {q ? "(changing these marks them as set by you)" : "(leave empty to choose automatically)"}</legend>
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
