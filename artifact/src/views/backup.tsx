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
      version: 2,
      exportedAt: new Date().toISOString(),
      questions: store.isEditor ? store.allQuestions() : [],
      batches: store.isEditor ? [...store.batches.values()] : [],
      myProgress: Object.fromEntries([...store.progress.entries()].map(([k, v]) => [k, v.attempts])),
      mySessions: [...store.sessions.values()],
    };
    save(`life-in-uk-backup-${stamp}.json`, JSON.stringify(data, null, 1));
  }

  function exportCsv() {
    const header = ["Test", "Question", "Prompt", "Options", "Correct answer(s)", "Explanation", "Memory tips", "Topics"];
    const lines = store.allQuestions().map((q) =>
      [q.exam, q.qnum, q.prompt, q.options.map((o) => `${o.key}) ${o.text}`), answerOf(q), q.explanation, q.tips, q.cats.map((c) => c.slug)].map(csvCell).join(","),
    );
    save(`life-in-uk-questions-${stamp}.csv`, [header.join(","), ...lines].join("\n"));
  }

  async function restore(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const data = JSON.parse(await file.text());
      if (data?.app !== APP) throw new Error("That file is not a backup from this page.");
      let added = 0;
      if (store.isEditor && Array.isArray(data.questions)) {
        const hashes = new Set(store.allQuestions().map((q) => q.hash));
        const fresh = (data.questions as Question[]).filter((q) => q?.id && q.prompt && !store.questions.has(q.id) && !hashes.has(q.hash));
        await store.putQuestions(fresh.map((q) => ({ ...q, tips: q.tips ?? [] })));
        added = fresh.length;
        for (const b of (data.batches ?? []) as Batch[]) if (b?.id && !store.batches.has(b.id)) await store.putBatch(b);
      }
      let answers = 0;
      const progress = (data.myProgress ?? (data.version === 1 ? {} : {})) as Record<string, Attempt[]>;
      for (const [qid, list] of Object.entries(progress)) {
        if (!store.questions.has(qid)) continue;
        const have = store.attemptsOf(qid);
        const known = new Set(have.map((a) => a.at));
        const add = list.filter((a) => !known.has(a.at));
        if (add.length) {
          answers += add.length;
          await store.setAttempts(qid, [...have, ...add].sort((a, b) => a.at.localeCompare(b.at)));
        }
      }
      for (const s of (data.mySessions ?? []) as Session[]) if (s?.id && !store.sessions.has(s.id)) await store.putSession(s);
      setMsg({ ok: true, text: `Restored ${added} questions and ${answers} answers. Anything already here was kept.` });
    } catch (err) {
      setMsg({ ok: false, text: err instanceof SyntaxError ? "That file is not valid JSON." : (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function deleteBatch(b: Batch) {
    for (const q of store.allQuestions().filter((q) => q.batchId === b.id)) await store.deleteQuestion(q.id);
    await store.deleteBatch(b.id);
  }

  const batches = [...store.batches.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <>
      <PageHeader title="Backup & data" sub="Questions are shared by everyone who uses this page. Your answers are private to you and follow you across devices." />
      <div className="grid2">
        <Panel title="Export">
          <p className="small muted">
            {store.isEditor ? "The full backup holds every question with its tips, the import history, and your own answers." : "The backup holds your own answers and test results."}
          </p>
          <div className="row wrap">
            <button className="btn btn-primary" onClick={exportJson}>
              Download backup (.json)
            </button>
            <button className="btn" onClick={exportCsv}>
              Questions as spreadsheet (.csv)
            </button>
          </div>
        </Panel>
        <Panel title="Restore">
          <p className="small muted">Merges a backup in. Anything already here is kept as it is, so restoring twice is safe.</p>
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
      <Panel title="Start over" className="mt-l">
        <p className="small muted">Clears your own answers and test results so every test is fresh again. The questions and tips stay.</p>
        <div>
          <ConfirmButton
            danger
            label="Clear my answers"
            confirmLabel={`Delete your ${[...store.progress.values()].reduce((n, p) => n + p.attempts.length, 0)} answers and ${store.sessions.size} sessions?`}
            onConfirm={async () => {
              await store.resetMyProgress();
              setMsg({ ok: true, text: "Your answers were cleared." });
            }}
          />
        </div>
      </Panel>
      {store.isEditor && (
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
                      <span className="strong small">{b.label ?? b.filename}</span>
                      <div className="tiny muted">
                        {fmt(b.createdAt)} · {n} questions now · added {b.stats.imported}, already there {b.stats.duplicates}
                      </div>
                    </div>
                    <ConfirmButton small danger label="Delete batch" confirmLabel={`Delete it and its ${n} questions for everyone?`} onConfirm={() => deleteBatch(b)} />
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}
    </>
  );
}
