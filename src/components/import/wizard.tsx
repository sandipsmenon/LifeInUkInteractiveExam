"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { api } from "@/lib/client";
import { formatDate } from "@/lib/format";
import type { MarkerStyle } from "@/lib/parser/types";
import type { ImportPreview, ImportReport, PreviewRecord } from "@/lib/server/importer";

type Row = PreviewRecord & { approved: boolean; editing: boolean; isImportant: boolean };
type ExamMode = "document" | "none" | "single" | "split";
type View = "all" | "issues" | "duplicates" | "rejected";

function defaultApproved(r: PreviewRecord) {
  return !r.duplicateOf && r.duplicateInFile === null && !r.issues.some((i) => i.severity === "error");
}

function assignExams(rows: Row[], mode: ExamMode, start: number, size: number, preview: ImportPreview): Row[] {
  return rows.map((r, i) => {
    const parsed = preview.records[i];
    if (mode === "document") return { ...r, mockExamNumber: parsed.mockExamNumber, questionNumber: parsed.questionNumber };
    if (mode === "none") return { ...r, mockExamNumber: null, questionNumber: null };
    if (mode === "single") return { ...r, mockExamNumber: start, questionNumber: i + 1 };
    return { ...r, mockExamNumber: start + Math.floor(i / size), questionNumber: (i % size) + 1 };
  });
}

export function ImportWizard({ initialImported }: { initialImported: boolean }) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState<"file" | "initial" | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [examMode, setExamMode] = useState<ExamMode>("none");
  const [examStart, setExamStart] = useState(1);
  const [examSize, setExamSize] = useState(24);
  const [label, setLabel] = useState("");
  const [view, setView] = useState<View>("all");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [sameFilePrompt, setSameFilePrompt] = useState(false);

  async function loadPreview(kind: "file" | "initial", markerStyle?: MarkerStyle) {
    setBusy(true);
    setError(null);
    setReport(null);
    try {
      let p: ImportPreview;
      if (kind === "initial") {
        p = await api<ImportPreview>("/api/import/initial", markerStyle ? { markerStyle } : {});
      } else {
        if (!file) throw new Error("Choose a file first.");
        const form = new FormData();
        form.append("file", file);
        if (markerStyle) form.append("markerStyle", markerStyle);
        const res = await fetch("/api/import/preview", { method: "POST", body: form });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error ?? `Upload failed (${res.status}).`);
        p = data;
      }
      const mode: ExamMode = p.interpretation.examHeadings.length ? "document" : "none";
      setSource(kind);
      setPreview(p);
      setExamMode(mode);
      setLabel(kind === "initial" ? "Mock tests 1–8" : p.filename.replace(/\.[^.]+$/, ""));
      setConfirmed(!p.interpretation.markerAmbiguous && mode === "document");
      setRows(
        assignExams(
          p.records.map((r) => ({ ...r, approved: defaultApproved(r), editing: false, isImportant: r.promptHighlighted })),
          mode,
          examStart,
          examSize,
          p,
        ),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function updateExamMode(mode: ExamMode, start = examStart, size = examSize) {
    setExamMode(mode);
    setExamStart(start);
    setExamSize(size);
    if (preview) setRows((rs) => assignExams(rs, mode, start, size, preview));
  }

  function patchRow(i: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  }

  async function commit(allowSameFile = false) {
    if (!preview) return;
    setBusy(true);
    setError(null);
    setSameFilePrompt(false);
    try {
      const res = await fetch("/api/import/commit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          filename: preview.filename,
          format: preview.format,
          fileHash: preview.fileHash,
          label,
          allowSameFile,
          interpretation: { ...preview.interpretation, examAssignment: { mode: examMode, start: examStart, size: examSize } },
          records: rows.map((r) => ({
            approved: r.approved,
            sourcePosition: r.sourcePosition,
            mockExamNumber: r.mockExamNumber,
            questionNumber: r.questionNumber,
            prompt: r.prompt,
            options: r.options.map(({ key, text }) => ({ key, text })),
            correctKeys: r.correctKeys,
            explanation: r.explanation,
            sourceResult: r.sourceResult,
            isImportant: r.isImportant,
            issues: r.issues,
            raw: r.raw,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setSameFilePrompt(true);
        return;
      }
      if (!res.ok) throw new Error(data.error ?? "Import failed.");
      setReport(data);
      setPreview(null);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const counts = useMemo(
    () => ({
      approved: rows.filter((r) => r.approved).length,
      issues: rows.filter((r) => r.issues.length).length,
      duplicates: rows.filter((r) => r.duplicateOf || r.duplicateInFile !== null).length,
      rejected: rows.filter((r) => !r.approved).length,
    }),
    [rows],
  );

  // ------------------------------------------------------------ report
  if (report) {
    return (
      <div className="card p-6" role="status">
        <h2 className="text-lg font-semibold">Import complete</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["Imported", report.imported],
            ["Skipped (rejected)", report.skipped],
            ["Duplicates skipped", report.duplicates],
            ["Imported with flags", report.flagged],
          ].map(([l, v]) => (
            <div key={l as string} className="rounded-lg bg-surface-2 p-3">
              <dt className="text-xs text-ink-2">{l}</dt>
              <dd className="text-2xl font-semibold tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href={`/questions?batch=${report.batchId}`} className="btn btn-primary">View imported questions</Link>
          {report.flagged > 0 && <Link href="/questions?mark=flagged" className="btn">Review flagged</Link>}
          <Link href="/practice" className="btn">Start practising</Link>
          <button className="btn" onClick={() => { setReport(null); setFile(null); setSource(null); }}>Import another file</button>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------ step 1: choose source
  if (!preview) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <div className="card p-5">
          <h2 className="font-semibold">Upload a document</h2>
          <p className="mt-1 text-sm text-ink-2">.docx (recommended), or .md / .txt. Maximum 5 MB.</p>
          <label htmlFor="file" className="label mt-4">File</label>
          <input
            id="file"
            type="file"
            accept=".docx,.md,.markdown,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="input"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <button className="btn btn-primary mt-3" disabled={!file || busy} onClick={() => loadPreview("file")}>
            {busy && source !== "initial" ? "Reading…" : "Preview import"}
          </button>
        </div>
        <div className="card p-5">
          <h2 className="font-semibold">Initial dataset</h2>
          <p className="mt-1 text-sm text-ink-2">
            Your document with mock tests 1–8 (192 questions) is bundled with the app.
            {initialImported ? " It has already been imported; previewing again will show every question as a duplicate." : ""}
          </p>
          <button className="btn mt-3" disabled={busy} onClick={() => loadPreview("initial")}>
            Preview initial dataset
          </button>
        </div>
        {error && <p role="alert" className="text-sm text-bad md:col-span-2">{error}</p>}
      </div>
    );
  }

  // ------------------------------------------------------------ step 2 + 3: interpretation and review
  const it = preview.interpretation;
  const visible = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) =>
      view === "all" ? true : view === "issues" ? r.issues.length > 0 : view === "duplicates" ? !!r.duplicateOf || r.duplicateInFile !== null : !r.approved,
    );

  return (
    <div className="space-y-4">
      <section className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">1. Confirm how the document was read</h2>
            <p className="text-sm text-ink-2">
              {preview.filename} · {preview.summary.total} questions found · {preview.summary.new} new · {preview.summary.duplicates} already in your bank
            </p>
          </div>
          <button className="btn btn-sm" onClick={() => setPreview(null)}>Choose another file</button>
        </div>

        {preview.previousImport && (
          <p className="mt-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            This exact file was already imported on {formatDate(preview.previousImport.createdAt)}
            {preview.previousImport.label ? ` (“${preview.previousImport.label}”)` : ""}. Duplicate questions will be skipped.
          </p>
        )}

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <fieldset>
            <legend className="label">How are correct answers marked?</legend>
            {it.markerAmbiguous && (
              <p className="mb-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
                The formatting is ambiguous, please confirm. Found valid marking in {it.markerCandidates.map((c) => `${c.questionsWithValidMarking} questions using ${c.style}`).join(" and ")}.
              </p>
            )}
            {(["bold", "highlight"] as const).map((m) => {
              const c = it.markerCandidates.find((x) => x.style === m)!;
              return (
                <label key={m} className="flex items-center gap-2 py-1 text-sm">
                  <input
                    type="radio"
                    name="marker"
                    checked={it.markerStyle === m}
                    disabled={busy}
                    onChange={() => loadPreview(source!, m)}
                  />
                  {m === "bold" ? "Bold text" : "Highlighted text"}
                  <span className="text-muted">({c.questionsWithValidMarking} questions look valid)</span>
                </label>
              );
            })}
          </fieldset>

          <fieldset>
            <legend className="label">Which mock exam are these questions from?</legend>
            {it.examHeadings.length > 0 ? (
              <label className="flex items-center gap-2 py-1 text-sm">
                <input type="radio" name="exam" checked={examMode === "document"} onChange={() => updateExamMode("document")} />
                Use headings in the document ({it.examHeadings.map((h) => h.text).join(", ")})
              </label>
            ) : (
              <p className="mb-2 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
                No “Mock test N” headings were found, so the importer cannot tell where one mock test ends and the next begins.
              </p>
            )}
            <label className="flex items-center gap-2 py-1 text-sm">
              <input type="radio" name="exam" checked={examMode === "none"} onChange={() => updateExamMode("none")} />
              Leave unassigned — I&apos;ll assign them later in the question bank
            </label>
            <label className="flex flex-wrap items-center gap-2 py-1 text-sm">
              <input type="radio" name="exam" checked={examMode === "single"} onChange={() => updateExamMode("single")} />
              All from mock test
              <input type="number" min={1} max={200} value={examStart} aria-label="Mock test number" className="input w-20"
                onChange={(e) => updateExamMode(examMode === "split" ? "split" : "single", Number(e.target.value) || 1)} />
            </label>
            <label className="flex flex-wrap items-center gap-2 py-1 text-sm">
              <input type="radio" name="exam" checked={examMode === "split"} onChange={() => updateExamMode("split")} />
              Split in order: every
              <input type="number" min={1} max={200} value={examSize} aria-label="Questions per mock test" className="input w-20"
                onChange={(e) => updateExamMode("split", examStart, Number(e.target.value) || 24)} />
              questions is a new mock test, starting at mock {examStart}
            </label>
            {examMode === "split" && (
              <p className="text-xs text-ink-2">
                → {Array.from({ length: Math.ceil(rows.length / examSize) }, (_, k) => `Mock ${examStart + k}: #${k * examSize + 1}–${Math.min(rows.length, (k + 1) * examSize)}`).join(" · ")}
              </p>
            )}
          </fieldset>
        </div>
        {it.notes.length > 0 && (
          <ul className="mt-3 list-disc pl-5 text-xs text-ink-2">
            {it.notes.map((n) => <li key={n}>{n}</li>)}
          </ul>
        )}
        {preview.ignoredBlocks.length > 0 && (
          <p className="mt-2 text-xs text-muted">Ignored text before the first question: “{preview.ignoredBlocks.slice(0, 3).join("”, “")}”</p>
        )}
        <label className="mt-4 flex items-start gap-2 text-sm">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-1" />
          I have checked how the answers and mock exams were interpreted.
        </label>
      </section>

      <section className="card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">2. Review records ({counts.approved} of {rows.length} approved)</h2>
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter records">
            {([
              ["all", `All ${rows.length}`],
              ["issues", `Issues ${counts.issues}`],
              ["duplicates", `Duplicates ${counts.duplicates}`],
              ["rejected", `Rejected ${counts.rejected}`],
            ] as const).map(([v, l]) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`btn btn-sm ${view === v ? "border-accent bg-accent-soft text-accent" : ""}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <ul className="space-y-2">
          {visible.map(({ r, i }) => (
            <RecordRow key={r.sourcePosition} row={r} onChange={(p) => patchRow(i, p)} />
          ))}
          {visible.length === 0 && <li className="py-6 text-center text-sm text-ink-2">Nothing in this view.</li>}
        </ul>
      </section>

      <section className="card sticky bottom-2 flex flex-wrap items-center gap-3 p-4 shadow-lg">
        <div className="min-w-48 flex-1">
          <label htmlFor="label" className="label">Batch name</label>
          <input id="label" className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={200} />
        </div>
        <div className="text-sm text-ink-2">
          {counts.approved} to import · {counts.rejected} rejected
        </div>
        <button className="btn btn-primary" disabled={busy || !confirmed || counts.approved === 0} onClick={() => commit(false)}>
          {busy ? "Importing…" : `Import ${counts.approved} question${counts.approved === 1 ? "" : "s"}`}
        </button>
        {!confirmed && <p className="w-full text-xs text-warn">Tick the confirmation in step 1 to enable importing.</p>}
        {sameFilePrompt && (
          <div className="w-full rounded-lg bg-warn-soft p-3 text-sm text-warn" role="alertdialog">
            This exact file was imported before. Import it again? Questions already in your bank will still be skipped.
            <div className="mt-2 flex gap-2">
              <button className="btn btn-sm" onClick={() => commit(true)}>Yes, import again</button>
              <button className="btn btn-sm" onClick={() => setSameFilePrompt(false)}>Cancel</button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="w-full text-sm text-bad">{error}</p>}
      </section>
    </div>
  );
}

function RecordRow({ row: r, onChange }: { row: Row; onChange: (p: Partial<Row>) => void }) {
  const answer = r.options.filter((o) => r.correctKeys.includes(o.key)).map((o) => o.text).join("; ");
  const hasError = r.issues.some((i) => i.severity === "error");
  return (
    <li className={`rounded-lg border p-3 ${r.approved ? "border-line" : "border-line bg-surface-2 opacity-80"}`}>
      <div className="flex items-start gap-3">
        <input type="checkbox" className="mt-1 h-5 w-5" aria-label={`Approve #${r.sourcePosition}`} checked={r.approved} onChange={(e) => onChange({ approved: e.target.checked })} />
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap gap-1.5 text-xs">
            <span className="chip">#{r.sourcePosition}</span>
            <span className="chip">{r.mockExamNumber ? `Mock ${r.mockExamNumber} · Q${r.questionNumber}` : "No mock exam"}</span>
            {r.duplicateOf ? (
              <Link href={`/questions/${r.duplicateOf.id}`} target="_blank" className="chip border-warn/50 text-warn">Already in bank ({r.duplicateOf.ref})</Link>
            ) : r.duplicateInFile !== null ? (
              <span className="chip border-warn/50 text-warn">Repeat of #{r.duplicateInFile}</span>
            ) : (
              <span className="chip border-good/50 text-good">New</span>
            )}
            {r.similarExisting && <span className="chip border-warn/50 text-warn" title={r.similarExisting.prompt}>Same wording, different options: {r.similarExisting.ref}</span>}
            {r.sourceResult && <span className="chip">{r.sourceResult === "correct" ? "Correct in mock" : "Incorrect in mock"}</span>}
            {r.questionType !== "single" && <span className="chip">{r.questionType === "multi" ? "Multiple answers" : "True/false"}</span>}
          </div>
          <p className="font-medium">{r.prompt}</p>
          <p className={`text-sm ${r.correctKeys.length ? "text-good" : "text-bad"}`}>
            {r.correctKeys.length ? `Answer: ${answer}` : "No correct answer detected"}
          </p>
          {r.issues.length > 0 && (
            <ul className="mt-1 space-y-0.5 text-xs">
              {r.issues.map((iss) => (
                <li key={iss.code + iss.message} className={iss.severity === "error" ? "text-bad" : "text-warn"}>
                  {iss.severity === "error" ? "Error: " : "Check: "}
                  {iss.message}
                </li>
              ))}
            </ul>
          )}
          <button className="mt-1 text-xs text-accent underline" onClick={() => onChange({ editing: !r.editing })} aria-expanded={r.editing}>
            {r.editing ? "Close editor" : hasError ? "Fix this record" : "Edit"}
          </button>
          {r.editing && (
            <div className="mt-2 space-y-2 rounded-lg bg-surface-2 p-3">
              <label className="label" htmlFor={`p-${r.sourcePosition}`}>Question</label>
              <textarea id={`p-${r.sourcePosition}`} className="input" value={r.prompt} onChange={(e) => onChange({ prompt: e.target.value })} />
              <p className="label">Options (tick correct)</p>
              {r.options.map((o, k) => (
                <div key={o.key} className="flex items-center gap-2">
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
                  <input
                    className="input"
                    aria-label={`Option ${o.key}`}
                    value={o.text}
                    onChange={(e) => onChange({ options: r.options.map((x, j) => (j === k ? { ...x, text: e.target.value } : x)) })}
                  />
                </div>
              ))}
              <label className="label" htmlFor={`e-${r.sourcePosition}`}>Explanation</label>
              <textarea id={`e-${r.sourcePosition}`} className="input" value={r.explanation ?? ""} onChange={(e) => onChange({ explanation: e.target.value || null })} />
              <p className="text-xs text-muted">The text exactly as it appeared in the document is stored alongside your edits.</p>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}
