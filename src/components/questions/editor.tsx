"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/lib/client";
import type { Category, QuestionDetail } from "@/lib/types";

const KEYS = "ABCDEFGHIJ";

export function QuestionEditor({ question, categories }: { question?: QuestionDetail; categories: Category[] }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(question?.prompt ?? "");
  const [options, setOptions] = useState(question?.options ?? [{ key: "A", text: "" }, { key: "B", text: "" }, { key: "C", text: "" }, { key: "D", text: "" }]);
  const [correct, setCorrect] = useState<string[]>(question?.correctKeys ?? []);
  const [explanation, setExplanation] = useState(question?.explanation ?? "");
  const [exam, setExam] = useState(question?.mockExamNumber?.toString() ?? "");
  const [qnum, setQnum] = useState(question?.questionNumber?.toString() ?? "");
  const [cats, setCats] = useState<string[]>(question?.categories.map((c) => c.slug) ?? []);
  const [topics, setTopics] = useState(question?.topics.join(", ") ?? "");
  const [notes, setNotes] = useState(question?.notes ?? "");
  const [aid, setAid] = useState(question?.memoryAid ?? "");
  const [important, setImportant] = useState(question?.isImportant ?? false);
  const [confusing, setConfusing] = useState(question?.isConfusing ?? false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function setOption(i: number, text: string) {
    setOptions((o) => o.map((x, j) => (j === i ? { ...x, text } : x)));
  }
  function removeOption(i: number) {
    const key = options[i].key;
    setOptions((o) => o.filter((_, j) => j !== i));
    setCorrect((c) => c.filter((k) => k !== key));
  }
  function addOption() {
    const used = new Set(options.map((o) => o.key));
    const key = [...KEYS].find((k) => !used.has(k)) ?? String(options.length + 1);
    setOptions((o) => [...o, { key, text: "" }]);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    const body = {
      prompt,
      options: options.filter((o) => o.text.trim()),
      correctKeys: correct,
      explanation: explanation.trim() || null,
      mockExamNumber: exam ? Number(exam) : null,
      questionNumber: qnum ? Number(qnum) : null,
      categories: cats,
      topics: topics.split(",").map((t) => t.trim()).filter(Boolean),
      notes: notes.trim() || null,
      memoryAid: aid.trim() || null,
      isImportant: important,
      isConfusing: confusing,
    };
    try {
      if (question) {
        await api(`/api/questions/${question.id}`, body, "PUT");
        setMsg({ ok: true, text: "Saved. The original imported version is kept below for reference." });
        router.refresh();
      } else {
        const res = await api<{ id: string }>("/api/questions", body);
        router.push(`/questions/${res.id}`);
      }
    } catch (err) {
      setMsg({ ok: false, text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <div>
        <label htmlFor="prompt" className="label">Question</label>
        <textarea id="prompt" className="input min-h-20" value={prompt} onChange={(e) => setPrompt(e.target.value)} required maxLength={1000} />
      </div>
      <fieldset>
        <legend className="label">Options — tick the correct answer(s)</legend>
        <ul className="space-y-2">
          {options.map((o, i) => (
            <li key={o.key} className="flex items-center gap-2">
              <input
                type="checkbox"
                aria-label={`Option ${o.key} is correct`}
                checked={correct.includes(o.key)}
                onChange={() => setCorrect((c) => (c.includes(o.key) ? c.filter((k) => k !== o.key) : [...c, o.key]))}
                className="h-5 w-5"
              />
              <input className="input" aria-label={`Option ${o.key}`} value={o.text} onChange={(e) => setOption(i, e.target.value)} maxLength={500} />
              <button type="button" className="btn btn-sm" onClick={() => removeOption(i)} disabled={options.length <= 2} aria-label={`Remove option ${o.key}`}>
                ✕
              </button>
            </li>
          ))}
        </ul>
        {options.length < 10 && (
          <button type="button" className="btn btn-sm mt-2" onClick={addOption}>Add option</button>
        )}
      </fieldset>
      <div>
        <label htmlFor="explanation" className="label">Explanation</label>
        <textarea id="explanation" className="input min-h-20" value={explanation} onChange={(e) => setExplanation(e.target.value)} maxLength={5000} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="exam" className="label">Mock exam number</label>
          <input id="exam" type="number" min={1} max={200} className="input" value={exam} onChange={(e) => setExam(e.target.value)} />
        </div>
        <div>
          <label htmlFor="qnum" className="label">Question number</label>
          <input id="qnum" type="number" min={1} max={1000} className="input" value={qnum} onChange={(e) => setQnum(e.target.value)} />
        </div>
      </div>
      <fieldset>
        <legend className="label">Categories {question && "(changing these marks them as manually set)"}</legend>
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => {
            const on = cats.includes(c.slug);
            return (
              <button
                key={c.slug}
                type="button"
                aria-pressed={on}
                onClick={() => setCats((x) => (on ? x.filter((s) => s !== c.slug) : [...x, c.slug]))}
                className={`chip min-h-8 ${on ? "border-accent bg-accent-soft text-accent" : ""}`}
              >
                {c.name}
              </button>
            );
          })}
        </div>
        {!question && <p className="mt-1 text-xs text-muted">Leave empty to categorise automatically.</p>}
      </fieldset>
      <div>
        <label htmlFor="topics" className="label">Topics (comma separated)</label>
        <input id="topics" className="input" value={topics} onChange={(e) => setTopics(e.target.value)} placeholder={question ? "" : "Leave empty to detect automatically"} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="aid" className="label">Memory aid</label>
          <textarea id="aid" className="input min-h-16" value={aid} onChange={(e) => setAid(e.target.value)} placeholder="e.g. 1455 → 1485: thirty years of roses" maxLength={2000} />
        </div>
        <div>
          <label htmlFor="notes" className="label">Notes</label>
          <textarea id="notes" className="input min-h-16" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} />
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" checked={important} onChange={(e) => setImportant(e.target.checked)} /> Important</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={confusing} onChange={(e) => setConfusing(e.target.checked)} /> Confusing</label>
      </div>
      {msg && <p role="status" className={`text-sm ${msg.ok ? "text-good" : "text-bad"}`}>{msg.text}</p>}
      <button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : question ? "Save changes" : "Add question"}</button>
    </form>
  );
}

export function QuestionDangerZone({ id, edited, hasOriginal }: { id: string; edited: boolean; hasOriginal: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, after: () => void) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      after();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      {edited && hasOriginal && (
        <button
          className="btn btn-sm"
          disabled={busy}
          onClick={() => confirm("Restore the original imported wording and answer?") && run(() => api(`/api/questions/${id}/restore`, {}), () => router.refresh())}
        >
          Restore original
        </button>
      )}
      <button
        className="btn btn-sm btn-danger"
        disabled={busy}
        onClick={() =>
          confirm("Delete this question and its practice history? This cannot be undone (export a backup first if unsure).") &&
          run(() => api(`/api/questions/${id}`, undefined, "DELETE"), () => router.push("/questions"))
        }
      >
        Delete question
      </button>
      {error && <p className="w-full text-sm text-bad">{error}</p>}
    </div>
  );
}

export function ResolveFlag({ id }: { id: string }) {
  const router = useRouter();
  return (
    <button className="btn btn-sm" onClick={async () => { await api(`/api/flags/${id}`, {}, "PATCH"); router.refresh(); }}>
      Mark resolved
    </button>
  );
}
