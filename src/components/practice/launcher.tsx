"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EXAM_FORMAT, MODES, type Category, type PracticeMode } from "@/lib/types";

interface Props {
  initialMode?: string;
  initialCategory?: string;
  initialExam?: string;
  categories: Category[];
  exams: { number: number; count: number }[];
  unassigned: number;
  batches: { id: string; label: string; count: number }[];
  due: number;
}

const ORDER: PracticeMode[] = ["weak", "revision", "quick", "category", "mixed", "mock", "rapid", "exam"];

export function PracticeLauncher(p: Props) {
  const router = useRouter();
  const [mode, setMode] = useState<PracticeMode>(
    (ORDER as string[]).includes(p.initialMode ?? "") ? (p.initialMode as PracticeMode) : "weak",
  );
  const [count, setCount] = useState(20);
  const [category, setCategory] = useState(p.initialCategory ?? p.categories[0]?.slug ?? "");
  const [mixed, setMixed] = useState<string[]>([]);
  const [source, setSource] = useState(p.initialExam ? `exam:${p.initialExam}` : p.exams[0] ? `exam:${p.exams[0].number}` : p.batches[0] ? `batch:${p.batches[0].id}` : "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { mode };
    if (["quick", "category", "mixed", "weak", "revision", "rapid"].includes(mode)) body.count = count;
    if (mode === "category") body.category = category;
    if (mode === "mixed" && mixed.length) body.categories = mixed;
    if (mode === "mock") {
      const [kind, value] = source.split(":");
      if (kind === "exam") body.exam = Number(value);
      else body.batch = value;
    }
    const res = await fetch("/api/practice/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setBusy(false);
      setError(data.error ?? "Could not start the session.");
      return;
    }
    router.push(`/practice/${data.id}`);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="sr-only">Practice mode</legend>
        {ORDER.map((m) => (
          <label
            key={m}
            className={`card flex cursor-pointer gap-3 p-4 ${mode === m ? "border-accent ring-2 ring-accent/30" : "hover:bg-surface-2"}`}
          >
            <input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-1 accent-[var(--accent)]" />
            <span>
              <span className="font-medium">
                {MODES[m].label}
                {m === "revision" && <span className="ml-2 chip">{p.due} due</span>}
              </span>
              <span className="mt-0.5 block text-sm text-ink-2">{MODES[m].description}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="card h-fit space-y-4 p-4 lg:sticky lg:top-20">
        <h2 className="font-semibold">{MODES[mode].label}</h2>
        {mode === "category" && (
          <div>
            <label htmlFor="cat" className="label">Category</label>
            <select id="cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {p.categories.map((c) => (
                <option key={c.slug} value={c.slug}>{c.name} ({c.questionCount})</option>
              ))}
            </select>
          </div>
        )}
        {mode === "mixed" && (
          <fieldset>
            <legend className="label">Categories to mix (none selected = all)</legend>
            <div className="flex flex-wrap gap-2">
              {p.categories.map((c) => {
                const on = mixed.includes(c.slug);
                return (
                  <button
                    key={c.slug}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setMixed((m) => (on ? m.filter((x) => x !== c.slug) : [...m, c.slug]))}
                    className={`chip min-h-8 ${on ? "border-accent bg-accent-soft text-accent" : ""}`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
        {mode === "mock" && (
          <div>
            <label htmlFor="src" className="label">Mock exam or imported batch</label>
            <select id="src" className="input" value={source} onChange={(e) => setSource(e.target.value)}>
              {p.exams.map((e) => (
                <option key={e.number} value={`exam:${e.number}`}>Mock test {e.number} ({e.count} questions)</option>
              ))}
              {p.batches.map((b) => (
                <option key={b.id} value={`batch:${b.id}`}>Batch: {b.label} ({b.count})</option>
              ))}
            </select>
            {p.unassigned > 0 && (
              <p className="mt-2 text-xs text-ink-2">
                {p.unassigned} questions are not assigned to a mock exam yet. Assign them in the{" "}
                <Link className="link" href="/questions?exam=none">question bank</Link>, or practise them by batch.
              </p>
            )}
          </div>
        )}
        {["quick", "category", "mixed", "weak", "revision", "rapid"].includes(mode) && (
          <div>
            <label htmlFor="count" className="label">Number of questions</label>
            <select id="count" className="input" value={count} onChange={(e) => setCount(Number(e.target.value))}>
              {[10, 20, 30, 50, 100].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        )}
        {mode === "exam" && (
          <p className="text-sm text-ink-2">
            {EXAM_FORMAT.questions} questions, {EXAM_FORMAT.minutes} minutes, pass mark {EXAM_FORMAT.passMark}/{EXAM_FORMAT.questions} (75%) — the
            official Life in the UK test format. Answers are only marked when you submit.
          </p>
        )}
        {mode === "weak" && (
          <p className="text-sm text-ink-2">Ranked by previous wrong answers, how often you forget, time since your last correct recall, and confidence. Each question shows why it was chosen.</p>
        )}
        {mode === "rapid" && <p className="text-sm text-ink-2">Dates, numbers and names. See the question, recall the answer in your head, reveal, and mark yourself.</p>}
        {error && <p role="alert" className="text-sm text-bad">{error}</p>}
        <button className="btn btn-primary w-full" onClick={start} disabled={busy || (mode === "mock" && !source)}>
          {busy ? "Starting…" : "Start"}
        </button>
      </div>
    </div>
  );
}
