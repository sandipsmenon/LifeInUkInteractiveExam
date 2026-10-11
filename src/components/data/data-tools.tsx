"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";

export function RestoreForm() {
  const router = useRouter();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const json = JSON.parse(await file.text());
      const res = await api<{ inserted: Record<string, number> }>("/api/restore", json);
      setMsg({ ok: true, text: `Restored: ${res.inserted.questions ?? 0} questions, ${res.inserted.attempts ?? 0} attempts. Existing records were left unchanged.` });
      router.refresh();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof SyntaxError ? "That file is not a valid backup." : (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <p className="text-sm text-ink-2">Merges a backup file into the database. Records that already exist are kept as they are, so it is safe to restore more than once.</p>
      <label htmlFor="restore" className="label mt-3">Backup file (.json)</label>
      <input id="restore" type="file" accept="application/json,.json" className="input" disabled={busy} onChange={(e) => onFile(e.target.files?.[0])} />
      {msg && <p role="status" className={`mt-2 text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</p>}
    </div>
  );
}

interface Batch {
  id: string;
  filename: string;
  label: string | null;
  createdAt: string;
  questionCount: number;
  stats: Record<string, number>;
}

export function BatchList({ batches }: { batches: Batch[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  if (!batches.length) return <p className="text-sm text-ink-2">No imports yet. <Link href="/import" className="link">Import questions</Link>.</p>;

  async function remove(b: Batch) {
    if (!confirm(`Delete “${b.label ?? b.filename}” AND its ${b.questionCount} questions with their practice history? Download a backup first if unsure.`)) return;
    try {
      await api(`/api/batches/${b.id}?withQuestions=1`, undefined, "DELETE");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <>
      <ul className="divide-y divide-line text-sm">
        {batches.map((b) => (
          <li key={b.id} className="flex flex-wrap items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <Link href={`/questions?batch=${b.id}`} className="font-medium hover:underline">{b.label ?? b.filename}</Link>
              <div className="text-xs text-muted">
                {b.filename} · {new Date(b.createdAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })} · {b.questionCount} questions now
                {b.stats?.imported !== undefined && ` · imported ${b.stats.imported}, duplicates ${b.stats.duplicates}, skipped ${b.stats.skipped}, flagged ${b.stats.flagged}`}
              </div>
            </div>
            <button className="btn btn-sm btn-danger" onClick={() => remove(b)}>Delete batch</button>
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-bad">{error}</p>}
    </>
  );
}
