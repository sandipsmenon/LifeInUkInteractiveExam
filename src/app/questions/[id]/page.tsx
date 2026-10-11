import Link from "next/link";
import { notFound } from "next/navigation";
import { FlagButton } from "@/components/flag-button";
import { QuestionDangerZone, QuestionEditor, ResolveFlag } from "@/components/questions/editor";
import { Section, StatusBadge } from "@/components/ui";
import { getQuestion, listCategories } from "@/lib/server/questions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Question" };

const fmt = (s: string) => new Date(s).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });

export default async function QuestionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [q, categories] = await Promise.all([getQuestion(id), listCategories()]);
  if (!q) notFound();
  const answerOf = (opts: { key: string; text: string }[], keys: string[]) => opts.filter((o) => keys.includes(o.key)).map((o) => o.text).join("; ");
  const o = q.original;

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Link href="/questions" className="link">← Question bank</Link>
        <span className="chip">{q.mockExamNumber ? `Mock ${q.mockExamNumber} · Q${q.questionNumber ?? "?"}` : "Not assigned to a mock exam"}</span>
        {q.sourcePosition && <span className="chip">Position {q.sourcePosition} in source document</span>}
        <StatusBadge status={q.status} />
        <div className="ml-auto"><FlagButton questionId={q.id} /></div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Section title={q.edited ? "Edit question (edited)" : "Edit question"}>
          <QuestionEditor question={q} categories={categories.filter((c) => c.slug !== "uncategorised")} />
        </Section>
        <div className="space-y-4">
          <Section title="Your progress">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-ink-2">Attempts</dt><dd className="tabular-nums">{q.attempts} ({q.attempts - q.wrong} correct)</dd>
              <dt className="text-ink-2">Mock test result</dt><dd>{q.sourceResult ?? "—"}</dd>
              <dt className="text-ink-2">Difficulty</dt><dd className="capitalize">{q.difficulty}</dd>
              <dt className="text-ink-2">Correct in a row</dt><dd className="tabular-nums">{q.review?.correctStreak ?? 0}</dd>
              <dt className="text-ink-2">Times forgotten</dt><dd className="tabular-nums">{q.review?.lapses ?? 0}</dd>
              <dt className="text-ink-2">Next review</dt><dd>{q.dueAt ? fmt(q.dueAt) : "Not scheduled"}</dd>
            </dl>
            {q.history.length > 0 && (
              <ul className="mt-3 max-h-48 space-y-1 overflow-auto text-xs">
                {q.history.map((h) => (
                  <li key={h.id} className="flex justify-between gap-2">
                    <span className={h.isCorrect ? "text-good" : "text-bad"}>{h.isCorrect ? "✓ Correct" : "✗ Incorrect"}</span>
                    <span className="text-muted">{h.mode} · {fmt(h.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
          {q.flags.length > 0 && (
            <Section title="Flags">
              <ul className="space-y-2 text-sm">
                {q.flags.map((f) => (
                  <li key={f.id} className="rounded-lg border border-line p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{f.reason.replace("_", " ")}</span>
                      {f.resolvedAt ? <span className="text-xs text-good">Resolved</span> : <ResolveFlag id={f.id} />}
                    </div>
                    {f.note && <p className="mt-1 text-ink-2">{f.note}</p>}
                    <p className="text-xs text-muted">{fmt(f.createdAt)}</p>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {o && (
            <Section title="Original (as imported)">
              <p className="text-sm font-medium">{o.prompt}</p>
              <ul className="mt-2 space-y-1 text-sm">
                {o.options.map((opt) => (
                  <li key={opt.key} className={o.correctKeys.includes(opt.key) ? "font-semibold text-good" : "text-ink-2"}>
                    {o.correctKeys.includes(opt.key) ? "✓ " : "• "}
                    {opt.text}
                  </li>
                ))}
              </ul>
              {o.raw?.result && <p className="mt-2 text-xs text-ink-2">Marked in document: {o.raw.result}</p>}
              {o.explanation && <p className="mt-2 text-xs text-ink-2">{o.explanation}</p>}
              {q.edited && (
                <p className="mt-2 rounded bg-warn-soft px-2 py-1 text-xs text-warn">
                  Edited. Current answer: {answerOf(q.options, q.correctKeys)}
                </p>
              )}
              {q.batch && <p className="mt-2 text-xs text-muted">Imported from {q.batch.filename} on {fmt(q.batch.createdAt)}</p>}
            </Section>
          )}
          <QuestionDangerZone id={q.id} edited={q.edited} hasOriginal={!!o} />
        </div>
      </div>
    </>
  );
}
