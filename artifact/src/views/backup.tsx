import * as React from "react";
import { useState } from "react";
import type { Attempt, Batch, Question, Session } from "../model";
import { answerOf, fmt } from "../logic";
import { ConfirmButton, PageHeader, Panel, useApp } from "../ui";

const APP = "life-in-uk-revision-artifact";

function csvCell(v: unknown) {
  let s = v == null ? "" : Array.isArray(v) ? v.join("; ") : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stop spreadsheets treating text as a formula
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function BackupView() {
  const { store, downloads, go } = useApp();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const stamp = new Date().toISOString().slice(0, 10);

  async function save(filename: string, data: string) {
    setMsg(null);
    if (!downloads) return setMsg({ ok: false, text: "Downloads are not available in this view." });
    try {
      await downloads.save({ filename, data });
      setMsg({ ok: true, text: `${filename} saved.` });
    } catch (err) {
      const code = (err as { code?: string })?.code;
      if (code !== "declined") setMsg({ ok: false, text: `The file could not be saved (${code ?? "error"}).` });
    }
  }

  function exportJson() {
    const data = {
      app: APP,
      version: 1,
      exportedAt: new Date().toISOString(),
      questions: store.allQuestions(),
      progress: Object.fromEntries([...store.progress.entries()].map(([k, v]) => [k, v.attempts])),
      sessions: [...store.sessions.values()],
      batches: [...store.batches.values()],
    };
    save(`life-in-uk-backup-${stamp}.json`, JSON.stringify(data, null, 1));
  }

  function exportCsv() {
    const header = ["Mock", "Question", "Prompt", "Options", "Correct answer(s)", "Explanation", "Mock result", "Categories", "Topics", "Notes", "Memory aid"];
    const lines = store.allQuestions().map((q) =>
      [q.exam, q.qnum, q.prompt, q.options.map((o) => `${o.key}) ${o.text}`), answerOf(q), q.explanation, q.sourceResult, q.cats.map((c) => c.slug), q.topics, q.notes, q.aid]
        .map(csvCell)
        .join(","),
    );
    save(`life-in-uk-questions-${stamp}.csv`, [header.join(","), ...lines].join("\n"));
  }

  async function restore(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const data = JSON.parse(await file.text());
      if (data?.app !== APP || data.version !== 1) throw new Error("That file is not a backup from this page.");
      const qs = (data.questions as Question[]).filter((q) => q?.id && q.prompt && !store.questions.has(q.id));
      const hashes = new Set(store.allQuestions().map((q) => q.hash));
      const fresh = qs.filter((q) => !hashes.has(q.hash));
      await store.putQuestions(fresh);
      let attempts = 0;
      for (const [qid, list] of Object.entries(data.progress as Record<string, Attempt[]>)) {
        if (!store.questions.has(qid)) continue;
        const have = store.attemptsOf(qid);
        const known = new Set(have.map((a) => a.at));
        const add = list.filter((a) => !known.has(a.at));
        if (add.length) {
          attempts += add.length;
          await store.setAttempts(qid, [...have, ...add].sort((a, b) => a.at.localeCompare(b.at)));
        }
      }
      for (const s of data.sessions as Session[]) if (s?.id && !store.sessions.has(s.id)) await store.putSession(s);
      for (const b of data.batches as Batch[]) if (b?.id && !store.batches.has(b.id)) await store.putBatch(b);
      setMsg({ ok: true, text: `Restored ${fresh.length} questions and ${attempts} answers. Existing records were left unchanged.` });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof SyntaxError ? "That file is not valid JSON." : (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function deleteBatch(b: Batch) {
    const qs = store.allQuestions().filter((q) => q.batchId === b.id);
    for (const q of qs) await store.deleteQuestion(q.id);
    await store.deleteBatch(b.id);
  }

  const batches = [...store.batches.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <>
      <PageHeader title="Backup & data" sub="Your data is saved in this page's private database and follows you across devices. Download a backup now and then, especially before big imports." />
      <div className="grid2">
        <Panel title="Export">
          <p className="small muted">The full backup holds every question, the original imported text, your answers, sessions and import history.</p>
          <div className="row wrap">
            <button className="btn btn-primary" onClick={exportJson}>
              Download full backup (.json)
            </button>
            <button className="btn" onClick={exportCsv}>
              Questions as spreadsheet (.csv)
            </button>
          </div>
        </Panel>
        <Panel title="Restore">
          <p className="small muted">Merges a backup into your data. Anything already here is kept as it is, so restoring twice is safe.</p>
          <div className="field">
            <label htmlFor="rfile">Backup file (.json)</label>
            <input id="rfile" type="file" accept=".json,application/json" disabled={busy} onChange={(e) => restore(e.target.files?.[0])} />
          </div>
        </Panel>
      </div>
      {msg && (
        <p className={`${msg.ok ? "ok" : "err"} mt`} role="status">
          {msg.text}
        </p>
      )}
      <Panel title={`Import batches (${batches.length})`} className="mt-l">
        {batches.length === 0 ? (
          <p className="small muted">
            No imports yet.{" "}
            <button className="linkbtn" onClick={() => go("import")}>
              Import questions
            </button>
          </p>
        ) : (
          <ul className="list">
            {batches.map((b) => {
              const n = store.allQuestions().filter((q) => q.batchId === b.id).length;
              return (
                <li key={b.id} className="list-row wrap">
                  <div className="minw0 grow">
                    <button className="linkbtn strong left" onClick={() => go("bank", `batch.${b.id}`)}>
                      {b.label ?? b.filename}
                    </button>
                    <div className="tiny muted">
                      {b.filename} · {fmt(b.createdAt)} · {n} questions now · imported {b.stats.imported}, duplicates {b.stats.duplicates}, skipped {b.stats.skipped}, flagged {b.stats.flagged}
                    </div>
                  </div>
                  <ConfirmButton small danger label="Delete batch" confirmLabel={`Delete it and its ${n} questions with their history?`} onConfirm={() => deleteBatch(b)} />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}
