import * as React from "react";
import { useMemo, useState } from "react";
import type { MarkerStyle } from "../../../src/lib/parser/types";
import { buildPreview, commitImport, type Preview, type PreviewRecord, type Report } from "../importer";
import { fmt } from "../logic";
import { PageHeader, Panel, useApp } from "../ui";

type ExamMode = "document" | "none" | "single" | "split";
type View = "all" | "issues" | "duplicates" | "rejected";

function assign(p: Preview, recs: PreviewRecord[], mode: ExamMode, start: number, size: number): PreviewRecord[] {
  return recs.map((r, i) => {
    const parsed = p.records[i];
    if (mode === "document") return { ...r, mockExamNumber: parsed.mockExamNumber, questionNumber: parsed.questionNumber };
    if (mode === "none") return { ...r, mockExamNumber: null, questionNumber: null };
    if (mode === "single") return { ...r, mockExamNumber: start, questionNumber: i + 1 };
    return { ...r, mockExamNumber: start + Math.floor(i / size), questionNumber: (i % size) + 1 };
  });
}

export function ImportView() {
  const { store, go } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [recs, setRecs] = useState<PreviewRecord[]>([]);
  const [examMode, setExamMode] = useState<ExamMode>("none");
  const [start, setStart] = useState(1);
  const [size, setSize] = useState(24);
  const [label, setLabel] = useState("");
  const [view, setView] = useState<View>("all");
  const [confirmed, setConfirmed] = useState(false);
  const [sameFileOk, setSameFileOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);

  async function load(marker?: MarkerStyle) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const p = await buildPreview(store, file, marker);
      const mode: ExamMode = p.interpretation.examHeadings.length ? "document" : "none";
      setPreview(p);
      setExamMode(mode);
      setLabel(file.name.replace(/\.[^.]+$/, ""));
      setConfirmed(!p.interpretation.markerAmbiguous && mode === "document");
      setSameFileOk(false);
      setRecs(assign(p, p.records, mode, start, size));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function changeExam(mode: ExamMode, s = start, z = size) {
    setExamMode(mode);
    setStart(s);
    setSize(z);
    if (preview) setRecs((r) => assign(preview, r, mode, s, z));
  }
  const patch = (i: number, p: Partial<PreviewRecord>) => setRecs((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));

  async function commit() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const rep = await commitImport(store, { ...preview, records: recs }, label, { examAssignment: { mode: examMode, start, size } });
      setReport(rep);
      setPreview(null);
      setFile(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(
    () => ({
      approved: recs.filter((r) => r.approved).length,
      issues: recs.filter((r) => r.issues.length).length,
      duplicates: recs.filter((r) => r.duplicateOf || r.duplicateInFile !== null).length,
      rejected: recs.filter((r) => !r.approved).length,
    }),
    [recs],
  );

  const help = (
    <details className="panel small mt-l">
      <summary className="strong">How should my document be formatted?</summary>
      <ul className="bullets">
        <li>Each question on its own line, followed by the answer options as a bulleted list.</li>
        <li>The correct option(s) in bold or highlighted. The importer detects which, and asks you if it is unclear.</li>
        <li>Optionally a line saying Correct or Incorrect (your mock-test result), then the explanation.</li>
        <li>Put a heading such as “Mock Test 4” before each test’s questions so they are numbered per exam automatically.</li>
        <li>Old .doc files must be re-saved as .docx. The file is read in your browser and is not uploaded or stored; only the questions you approve are saved.</li>
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
                ["Imported", report.imported],
                ["Skipped (rejected)", report.skipped],
                ["Duplicates skipped", report.duplicates],
                ["Imported with flags", report.flagged],
              ] as const
            ).map(([l, v]) => (
              <div key={l} className="stat">
                <div className="stat-label">{l}</div>
                <div className="stat-value">{v}</div>
              </div>
            ))}
          </div>
          <div className="row wrap mt">
            <button className="btn btn-primary" onClick={() => go("bank", `batch.${report.batchId}`)}>
              View imported questions
            </button>
            {report.flagged > 0 && (
              <button className="btn" onClick={() => go("bank", "mark.flagged")}>
                Review flagged
              </button>
            )}
            <button className="btn" onClick={() => go("practice")}>
              Start practising
            </button>
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
        <PageHeader title="Import questions" sub="Add the Word document (.docx) for your latest mock tests. Nothing is saved until you have reviewed it, and questions already in your bank are never duplicated." />
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
          <button className="btn btn-primary" disabled={!file || busy} onClick={() => load()}>
            {busy ? "Reading…" : "Preview import"}
          </button>
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
                        {fmt(b.createdAt)} · imported {b.stats.imported}, duplicates {b.stats.duplicates}, skipped {b.stats.skipped}
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
    .filter(({ r }) => (view === "all" ? true : view === "issues" ? r.issues.length > 0 : view === "duplicates" ? !!r.duplicateOf || r.duplicateInFile !== null : !r.approved));

  return (
    <>
      <PageHeader title="Import questions" />
      <Panel title="1. Confirm how the document was read" action={<button className="btn btn-sm" onClick={() => setPreview(null)}>Choose another file</button>}>
        <p className="small muted">
          {preview.filename} · {recs.length} questions found · {recs.filter((r) => !r.duplicateOf && r.duplicateInFile === null).length} new ·{" "}
          {counts.duplicates} already in your bank
        </p>
        {preview.previousImport && (
          <p className="notice-inline small">
            This exact file was already imported on {fmt(preview.previousImport.createdAt)}. Duplicates will be skipped.
          </p>
        )}
        <div className="grid2 mt">
          <fieldset className="field">
            <legend>How are correct answers marked?</legend>
            {it.markerAmbiguous && (
              <p className="notice-inline small">
                The formatting is unclear, please confirm. Valid marking was found in{" "}
                {it.markerCandidates.map((c) => `${c.questionsWithValidMarking} questions using ${c.style}`).join(" and ")}.
              </p>
            )}
            {(["bold", "highlight"] as const).map((m) => (
              <label key={m} className="row small">
                <input type="radio" name="marker" checked={it.markerStyle === m} disabled={busy} onChange={() => load(m)} />
                {m === "bold" ? "Bold text" : "Highlighted text"}
                <span className="muted">({it.markerCandidates.find((c) => c.style === m)?.questionsWithValidMarking ?? 0} questions look valid)</span>
              </label>
            ))}
          </fieldset>
          <fieldset className="field">
            <legend>Which mock exam are these questions from?</legend>
            {it.examHeadings.length > 0 ? (
              <label className="row small">
                <input type="radio" name="exam" checked={examMode === "document"} onChange={() => changeExam("document")} />
                Use headings in the document ({it.examHeadings.map((h) => h.text).join(", ")})
              </label>
            ) : (
              <p className="notice-inline small">No “Mock test N” headings were found, so where one test ends and the next begins is unknown.</p>
            )}
            <label className="row small">
              <input type="radio" name="exam" checked={examMode === "none"} onChange={() => changeExam("none")} />
              Leave unassigned (assign later in the question bank)
            </label>
            <label className="row small wrap">
              <input type="radio" name="exam" checked={examMode === "single"} onChange={() => changeExam("single")} />
              All from mock test
              <input className="num-input" aria-label="Mock test number" inputMode="numeric" value={start} onChange={(e) => changeExam(examMode === "split" ? "split" : "single", Number(e.target.value) || 1)} />
            </label>
            <label className="row small wrap">
              <input type="radio" name="exam" checked={examMode === "split"} onChange={() => changeExam("split")} />
              Every
              <input className="num-input" aria-label="Questions per mock test" inputMode="numeric" value={size} onChange={(e) => changeExam("split", start, Number(e.target.value) || 24)} />
              questions is a new mock test, from mock {start}
            </label>
            {examMode === "split" && (
              <p className="tiny muted">
                {Array.from({ length: Math.ceil(recs.length / size) }, (_, k) => `Mock ${start + k}: #${k * size + 1}–${Math.min(recs.length, (k + 1) * size)}`).join(" · ")}
              </p>
            )}
          </fieldset>
        </div>
        {it.notes.length > 0 && (
          <ul className="bullets tiny muted">
            {it.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        )}
        {preview.ignored.length > 0 && <p className="tiny muted">Ignored text before the first question: “{preview.ignored.slice(0, 3).join("”, “")}”</p>}
        <label className="row small mt">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />I have checked how the answers and mock exams were interpreted.
        </label>
      </Panel>

      <Panel
        title={`2. Review records (${counts.approved} of ${recs.length} approved)`}
        className="mt-l"
        action={
          <div className="seg" role="tablist" aria-label="Filter records">
            {(
              [
                ["all", `All ${recs.length}`],
                ["issues", `Issues ${counts.issues}`],
                ["duplicates", `Duplicates ${counts.duplicates}`],
                ["rejected", `Rejected ${counts.rejected}`],
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
          {visible.map(({ r, i }) => (
            <Record key={r.sourcePosition} r={r} onChange={(p) => patch(i, p)} />
          ))}
          {visible.length === 0 && <li className="center small muted">Nothing in this view.</li>}
        </ul>
      </Panel>

      <div className="commit-bar">
        <div className="field grow">
          <label htmlFor="ilabel">Batch name</label>
          <input id="ilabel" value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <span className="small muted">
          {counts.approved} to import · {counts.rejected} rejected
        </span>
        {preview.previousImport && (
          <label className="row small">
            <input type="checkbox" checked={sameFileOk} onChange={(e) => setSameFileOk(e.target.checked)} />
            Import this file again
          </label>
        )}
        <button className="btn btn-primary" disabled={busy || !confirmed || counts.approved === 0 || (!!preview.previousImport && !sameFileOk)} onClick={commit}>
          {busy ? "Importing…" : `Import ${counts.approved} question${counts.approved === 1 ? "" : "s"}`}
        </button>
        {!confirmed && <p className="tiny warn-text full">Tick the confirmation in step 1 to enable importing.</p>}
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
      <input type="checkbox" aria-label={`Approve #${r.sourcePosition}`} checked={r.approved} onChange={(e) => onChange({ approved: e.target.checked })} />
      <div className="minw0 grow">
        <div className="chips">
          <span className="chip static">#{r.sourcePosition}</span>
          <span className="chip static">{r.mockExamNumber ? `Mock ${r.mockExamNumber} · Q${r.questionNumber}` : "No mock exam"}</span>
          {r.duplicateOf ? (
            <span className="chip static warn">Already in bank ({r.duplicateOf.ref})</span>
          ) : r.duplicateInFile !== null ? (
            <span className="chip static warn">Repeat of #{r.duplicateInFile}</span>
          ) : (
            <span className="chip static good">New</span>
          )}
          {r.similarExisting && <span className="chip static warn">Same wording, different options: {r.similarExisting.ref}</span>}
          {r.sourceResult && <span className="chip static">{r.sourceResult === "correct" ? "Correct in mock" : "Incorrect in mock"}</span>}
          {r.questionType !== "single" && <span className="chip static">{r.questionType === "multi" ? "Multiple answers" : "True/false"}</span>}
        </div>
        <p className="strong small">{r.prompt}</p>
        <p className={`small ${r.correctKeys.length ? "good-text" : "bad-text"}`}>{r.correctKeys.length ? `Answer: ${answer}` : "No correct answer detected"}</p>
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
        <button className="linkbtn tiny" aria-expanded={editing} onClick={() => setEditing(!editing)}>
          {editing ? "Close editor" : hasError ? "Fix this record" : "Edit"}
        </button>
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
            <p className="tiny muted">The text exactly as it appeared in the document is kept alongside your edits.</p>
          </div>
        )}
      </div>
    </li>
  );
}
