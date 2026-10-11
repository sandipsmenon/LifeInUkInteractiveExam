"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusBadge } from "@/components/ui";
import { api } from "@/lib/client";
import type { QuestionSummary } from "@/lib/types";

const DIFF_STYLE = { hard: "text-bad", medium: "text-warn", easy: "text-good", unrated: "text-muted" } as const;

export function QuestionList({ rows }: { rows: QuestionSummary[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [exam, setExam] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!rows.length) {
    return <div className="card p-8 text-center text-sm text-ink-2">No questions match. Try clearing a filter.</div>;
  }
  const all = selected.length === rows.length;

  async function assign() {
    setBusy(true);
    setMsg(null);
    try {
      await api("/api/questions/assign-exam", {
        ids: selected,
        mockExamNumber: exam === "none" ? null : Number(exam),
        renumber: true,
      });
      setMsg(`Updated ${selected.length} question${selected.length === 1 ? "" : "s"}.`);
      setSelected([]);
      router.refresh();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="card mb-2 flex flex-wrap items-center gap-2 p-3 text-sm">
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={all} onChange={() => setSelected(all ? [] : rows.map((r) => r.id))} />
          Select all on page
        </label>
        <span className="text-ink-2">{selected.length} selected</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <label htmlFor="assign-exam" className="text-ink-2">Assign to</label>
          <select id="assign-exam" className="input w-auto" value={exam} onChange={(e) => setExam(e.target.value)}>
            <option value="">Mock exam…</option>
            {Array.from({ length: 40 }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>Mock {n}</option>
            ))}
            <option value="none">Not assigned</option>
          </select>
          <button className="btn btn-sm" disabled={!selected.length || !exam || busy} onClick={assign}>Apply</button>
        </div>
        {msg && <p role="status" className="w-full text-xs text-ink-2">{msg} Question numbers follow the original document order.</p>}
      </div>
      <ul className="space-y-2">
        {rows.map((q) => {
          const answer = q.options.filter((o) => q.correctKeys.includes(o.key)).map((o) => o.text).join("; ");
          const checked = selected.includes(q.id);
          return (
            <li key={q.id} className={`card flex gap-3 p-3 sm:p-4 ${checked ? "border-accent" : ""}`}>
              <input
                type="checkbox"
                className="mt-1"
                aria-label={`Select: ${q.prompt}`}
                checked={checked}
                onChange={() => setSelected((s) => (checked ? s.filter((x) => x !== q.id) : [...s, q.id]))}
              />
              <div className="min-w-0 flex-1">
                <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
                  <span className="chip font-medium">
                    {q.mockExamNumber ? `Mock ${q.mockExamNumber} · Q${q.questionNumber ?? "?"}` : `Unassigned · #${q.sourcePosition ?? "?"}`}
                  </span>
                  <StatusBadge status={q.status} />
                  {q.sourceResult === "incorrect" && <span className="chip border-bad/40 text-bad">Wrong in mock</span>}
                  {q.isImportant && <span className="chip border-warn/50 text-warn">Important</span>}
                  {q.isConfusing && <span className="chip">Confusing</span>}
                  {q.openFlags > 0 && <span className="chip border-bad/40 text-bad">Flagged</span>}
                  {q.edited && <span className="chip">Edited</span>}
                </div>
                <Link href={`/questions/${q.id}`} className="font-medium hover:underline">{q.prompt}</Link>
                <p className="mt-1 text-sm text-ink-2">
                  <span className="text-muted">Answer: </span>
                  {answer}
                </p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
                  <span>{q.categories.map((c) => c.name).join(", ")}</span>
                  <span>
                    {q.attempts} attempt{q.attempts === 1 ? "" : "s"}
                    {q.attempts ? `, ${q.attempts - q.wrong} correct` : ""}
                  </span>
                  <span className={DIFF_STYLE[q.difficulty]}>{q.difficulty === "unrated" ? "Unrated" : `${q.difficulty[0].toUpperCase()}${q.difficulty.slice(1)}`}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
