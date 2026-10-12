import * as React from "react";
import { useMemo, useState } from "react";
import type { MarkerStyle } from "../../../src/lib/parser/types";
import { buildPreview, commitImport, type Preview, type PreviewRecord, type Report } from "../importer";
import { fmt } from "../logic";
import { PER_TEST, placement } from "../model";
import { generateTips, sampleErrorText } from "../tips";
import { PageHeader, Panel, useApp } from "../ui";

type ExamMode = "auto" | "document" | "none";
type View = "new" | "issues" | "duplicates" | "all";

function assign(p: Preview, recs: PreviewRecord[], mode: ExamMode): PreviewRecord[] {
  return recs.map((r, i) => {
    const parsed = p.records[i];
    if (mode === "document") return { ...r, mockExamNumber: parsed.mockExamNumber, questionNumber: parsed.questionNumber };
    if (mode === "none") return { ...r, mockExamNumber: null, questionNumber: null };
    const place = r.pos ? placement(r.pos) : { exam: null, qnum: null };
    return { ...r, mockExamNumber: place.exam, questionNumber: place.qnum };
  });
}

export function ImportView() {
  const { store, go, sample } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [recs, setRecs] = useState<PreviewRecord[]>([]);
  const [examMode, setExamMode] = useState<ExamMode>("auto");
  const [label, setLabel] = useState("");
  const [view, setView] = useState<View>("new");
  const [sameFileOk, setSameFileOk] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [tipState, setTipState] = useState<{ done: number; total: number; error?: string } | null>(null);

  async function load(marker?: MarkerStyle) {
    if (!file) return;
    setBusy("Reading the document…");
    setError(null);
    try {
      const p = await buildPreview(store, file, marker);
      setPreview(p);
      setExamMode("auto");
      setLabel(file.name.replace(/\.[^.]+$/, ""));
      setSameFileOk(false);
      setRecs(assign(p, p.records, "auto"));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function changeExam(mode: ExamMode) {
    setExamMode(mode);
    if (preview) setRecs((r) => assign(preview, r, mode));
  }
  const patch = (i: number, p: Partial<PreviewRecord>) => setRecs((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  async function writeTips(ids: string[]) {
    if (!sample || !ids.length) return;
    setTipState({ done: 0, total: ids.length });
    for (let i = 0; i < ids.length; i += 12) {
      const chunk = ids.slice(i, i + 12).map((id) => store.questions.get(id)!).filter(Boolean);
      try {
        const res = await generateTips(sample, chunk);
        await store.putQuestions(chunk.filter((q) => res[q.id]).map((q) => ({ ...store.questions.get(q.id)!, tips: res[q.id] })));
        setTipState({ done: Math.min(i + 12, ids.length), total: ids.length });
      } catch (e) {
        setTipState({ done: i, total: ids.length, error: sampleErrorText(e) });
        return;
      }
    }
  }

  async function commit() {
    if (!preview) return;
    setError(null);
    setBusy("Saving questions…");
    try {
      const rep = await commitImport(store, { ...preview, records: recs }, label, { examAssignment: examMode }, (n) => setBusy(`Saving questions… ${n}`));
      setReport(rep);
      setPreview(null);
      setFile(null);
      setBusy(null);
      void writeTips(rep.newIds);
    } catch (err) {
      setError((err as Error).message);
      setBusy(null);
    }
  }

  const counts = useMemo(
    () => ({
      approved: recs.filter((r) => r.approved).length,
      fresh: recs.filter((r) => !r.duplicateOf && r.duplicateInFile === null).length,
      issues: recs.filter((r) => r.issues.length).length,
      duplicates: recs.filter((r) => r.duplicateOf || r.duplicateInFile !== null).length,
    }),
    [recs],
  );
  const newTests = useMemo(() => [...new Set(recs.filter((r) => r.approved && r.mockExamNumber).map((r) => r.mockExamNumber!))].sort((a, b) => a - b), [recs]);

  const help = (
    <details className="panel small mt-l">
      <summary className="strong">How should the document look?</summary>
      <ul className="bullets">
        <li>Each question on its own line, then its answer options as a bulleted list, with the correct option(s) in bold or highlighted.</li>
        <li>An explanation after the options is kept. “Correct”/“Incorrect” lines are ignored.</li>
        <li>The easiest way: keep one master document and upload the whole thing each time. Questions already here are recognised and skipped, and the new ones fill the next tests in order (24 per test).</li>
        <li>Uploading only the new questions also works: they continue after the last question.</li>
        <li>The file is read in your browser; only the questions you approve are saved.</li>
      </ul>
    </details>
  );

  if (report) {
    return (
      <>
        <PageHeader title="Import complete" />
        <Panel>
          <div className="grid4">
            {(
              [
                ["New questions", report.imported],
                ["Already here", report.duplicates],
                ["Skipped", report.skipped],
                ["Flagged to check", report.flagged],
              ] as const
            ).map(([l, v]) => (
              <div key={l} className="stat">
                <div className="stat-label">{l}</div>
                <div className="stat-value">{v}</div>
              </div>
            ))}
          </div>
          {tipState && (
            <p className={`small ${tipState.error ? "err" : ""}`} role="status">
              {tipState.error
                ? `${tipState.error} You can finish this later from Questions → “Write tips”.`
                : tipState.done < tipState.total
                  ? `Claude is writing memory tips… ${tipState.done}/${tipState.total}`
                  : `Memory tips written for all ${tipState.total} new questions.`}
            </p>
          )}
          {!sample && report.imported > 0 && <p className="small muted">Memory tips can be written by Claude when this page is opened on claude.ai (Questions → “Write tips”).</p>}
          <div className="row wrap">
            <button className="btn btn-primary" onClick={() => go("tests")}>
              See the tests
            </button>
            {report.flagged > 0 && (
              <button className="btn" onClick={() => go("bank", "mark.flagged")}>
                Check flagged
              </button>
            )}
            <button className="btn" onClick={() => setReport(null)}>
              Import another file
            </button>
          </div>
        </Panel>
      </>
    );
  }

  if (!preview) {
    return (
      <>
        <PageHeader
          title="Import questions"
          sub={`There are ${store.questions.size} questions now (${Math.ceil(store.maxPos() / PER_TEST)} tests). Upload your updated Word document to add the next tests.`}
        />
        <Panel>
          <div className="field">
            <label htmlFor="ifile">Document (.docx, or .md / .txt; up to 5 MB)</label>
            <input id="ifile" type="file" accept=".docx,.md,.markdown,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          {error && (
            <p className="err" role="alert">
              {error}
            </p>
          )}
          <div>
            <button className="btn btn-primary" disabled={!file || !!busy} onClick={() => load()}>
              {busy ?? "Preview import"}
            </button>
          </div>
        </Panel>
        {store.batches.size > 0 && (
          <Panel title="Previous imports" className="mt-l">
            <ul className="list">
              {[...store.batches.values()]
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
                .map((b) => (
                  <li key={b.id} className="list-row">
                    <span className="minw0">
                      <span className="strong small">{b.label ?? b.filename}</span>
                      <span className="block tiny muted">
                        {fmt(b.createdAt)} · {b.stats.imported} new, {b.stats.duplicates} already there
                      </span>
                    </span>
                  </li>
                ))}
            </ul>
          </Panel>
        )}
        {help}
      </>
    );
  }

  const it = preview.interpretation;
  const visible = recs
    .map((r, i) => ({ r, i }))
    .filter(({ r }) =>
      view === "all" ? true : view === "issues" ? r.issues.length > 0 : view === "duplicates" ? !!r.duplicateOf || r.duplicateInFile !== null : !r.duplicateOf && r.duplicateInFile === null,
    );

  return (
    <>
      <PageHeader title="Import questions" />
      <Panel title="1. What was found" action={<button className="btn btn-sm" onClick={() => setPreview(null)}>Choose another file</button>}>
        <p className="small">
          <strong>{preview.filename}</strong>: {recs.length} questions · <strong>{counts.fresh} new</strong> · {counts.duplicates} already here
        </p>
        {preview.cumulative ? (
          <p className="small muted">This looks like your master document: the questions already here are in the same order, so new questions keep their position in it.</p>
        ) : (
          counts.fresh > 0 && <p className="small muted">New questions will continue after question {preview.firstNewPos - 1}.</p>
        )}
        {preview.previousImport && <p className="notice-inline small">This exact file was imported on {fmt(preview.previousImport.createdAt)}.</p>}
        {it.markerAmbiguous && (
          <fieldset className="field">
            <legend>The correct answers are marked unclearly. Which marking is right?</legend>
            {(["bold", "highlight"] as const).map((m) => (
              <label key={m} className="row small">
                <input type="radio" name="marker" checked={it.markerStyle === m} disabled={!!busy} onChange={() => load(m)} />
                {m === "bold" ? "Bold text" : "Highlighted text"} ({it.markerCandidates.find((c) => c.style === m)?.questionsWithValidMarking ?? 0} questions look valid)
              </label>
            ))}
          </fieldset>
        )}
        <fieldset className="field">
          <legend>Which test do new questions go in?</legend>
          <label className="row small">
            <input type="radio" name="exam" checked={examMode === "auto"} onChange={() => changeExam("auto")} />
            In order, {PER_TEST} per test (recommended){newTests.length ? `: fills Test ${newTests[0]}${newTests.length > 1 ? `–${newTests[newTests.length - 1]}` : ""}` : ""}
          </label>
          {it.examHeadings.length > 0 && (
            <label className="row small">
              <input type="radio" name="exam" checked={examMode === "document"} onChange={() => changeExam("document")} />
              Use the test headings in the document
            </label>
          )}
          <label className="row small">
            <input type="radio" name="exam" checked={examMode === "none"} onChange={() => changeExam("none")} />
            Don’t put them in a test yet
          </label>
        </fieldset>
      </Panel>

      <Panel
        title={`2. Review (${counts.approved} to add)`}
        className="mt-l"
        action={
          <div className="seg" role="tablist" aria-label="Filter records">
            {(
              [
                ["new", `New ${counts.fresh}`],
                ["issues", `Issues ${counts.issues}`],
                ["duplicates", `Already here ${counts.duplicates}`],
                ["all", `All ${recs.length}`],
              ] as const
            ).map(([v, l]) => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>
                {l}
              </button>
            ))}
          </div>
        }
      >
        <ul className="stack">
          {visible.slice(0, 300).map(({ r, i }) => (
            <Record key={r.sourcePosition} r={r} onChange={(p) => patch(i, p)} />
          ))}
          {visible.length > 300 && <li className="tiny muted center">Showing the first 300 of {visible.length}.</li>}
          {visible.length === 0 && <li className="center small muted">Nothing in this view.</li>}
        </ul>
      </Panel>

      <div className="commit-bar">
        <div className="field grow">
          <label htmlFor="ilabel">Batch name</label>
          <input id="ilabel" value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} />
        </div>
        {preview.previousImport && (
          <label className="row small">
            <input type="checkbox" checked={sameFileOk} onChange={(e) => setSameFileOk(e.target.checked)} />
            Import this file again
          </label>
        )}
        <button className="btn btn-primary" disabled={!!busy || counts.approved === 0 || (!!preview.previousImport && !sameFileOk)} onClick={commit}>
          {busy ?? `Add ${counts.approved} question${counts.approved === 1 ? "" : "s"}`}
        </button>
        {sample && counts.approved > 0 && <p className="tiny muted full">Claude will then write a memory tip for each new question.</p>}
        {error && (
          <p className="err full" role="alert">
            {error}
          </p>
        )}
      </div>
    </>
  );
}

function Record({ r, onChange }: { r: PreviewRecord; onChange: (p: Partial<PreviewRecord>) => void }) {
  const [editing, setEditing] = useState(false);
  const answer = r.options.filter((o) => r.correctKeys.includes(o.key)).map((o) => o.text).join("; ");
  const hasError = r.issues.some((i) => i.severity === "error");
  return (
    <li className={`rec ${r.approved ? "" : "rejected"}`}>
      <input type="checkbox" aria-label={`Add #${r.sourcePosition}`} checked={r.approved} onChange={(e) => onChange({ approved: e.target.checked })} />
      <div className="minw0 grow">
        <div className="chips">
          <span className="chip static">#{r.sourcePosition}</span>
          {r.duplicateOf ? (
            <span className="chip static">Already here ({r.duplicateOf.ref})</span>
          ) : r.duplicateInFile !== null ? (
            <span className="chip static warn">Repeat of #{r.duplicateInFile}</span>
          ) : (
            <>
              <span className="chip static good">New</span>
              <span className="chip static">{r.mockExamNumber ? `Test ${r.mockExamNumber} · Q${r.questionNumber}` : "No test"}</span>
            </>
          )}
          {r.similarExisting && <span className="chip static warn">Same wording as {r.similarExisting.ref}</span>}
        </div>
        <p className="strong small">{r.prompt}</p>
        <p className={`small ${r.correctKeys.length ? "good-text" : "bad-text"}`}>{r.correctKeys.length ? `Answer: ${answer}` : "No correct answer found"}</p>
        {r.issues.length > 0 && (
          <ul className="tiny issues">
            {r.issues.map((iss) => (
              <li key={iss.code + iss.message} className={iss.severity === "error" ? "bad-text" : "warn-text"}>
                {iss.severity === "error" ? "Error: " : "Check: "}
                {iss.message}
              </li>
            ))}
          </ul>
        )}
        {!r.duplicateOf && (
          <button className="linkbtn tiny" aria-expanded={editing} onClick={() => setEditing(!editing)}>
            {editing ? "Close editor" : hasError ? "Fix this question" : "Edit"}
          </button>
        )}
        {editing && (
          <div className="rec-edit">
            <label htmlFor={`rp-${r.sourcePosition}`} className="tiny muted">
              Question
            </label>
            <textarea id={`rp-${r.sourcePosition}`} value={r.prompt} onChange={(e) => onChange({ prompt: e.target.value })} />
            <p className="tiny muted">Options (tick correct)</p>
            {r.options.map((o, k) => (
              <div key={o.key} className="row opt-edit">
                <input
                  type="checkbox"
                  aria-label={`Option ${o.key} correct`}
                  checked={r.correctKeys.includes(o.key)}
                  onChange={() =>
                    onChange({
                      correctKeys: r.correctKeys.includes(o.key) ? r.correctKeys.filter((x) => x !== o.key) : [...r.correctKeys, o.key].sort(),
                      issues: r.issues.filter((x) => x.code !== "no_correct_marked" && x.code !== "count_mismatch"),
                    })
                  }
                />
                <input aria-label={`Option ${o.key}`} value={o.text} onChange={(e) => onChange({ options: r.options.map((x, j) => (j === k ? { ...x, text: e.target.value } : x)) })} />
              </div>
            ))}
            <label htmlFor={`re-${r.sourcePosition}`} className="tiny muted">
              Explanation
            </label>
            <textarea id={`re-${r.sourcePosition}`} value={r.explanation ?? ""} onChange={(e) => onChange({ explanation: e.target.value || null })} />
          </div>
        )}
      </div>
    </li>
  );
}
