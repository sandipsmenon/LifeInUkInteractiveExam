import Link from "next/link";
import { Meter, PageHeader, Section, Stat, StatusBadge, pct } from "@/components/ui";
import type { ReviewStatus } from "@/lib/srs";
import { progressStats } from "@/lib/server/stats";

export const dynamic = "force-dynamic";
export const metadata = { title: "Progress" };

export default async function ProgressPage() {
  const p = await progressStats();
  const recent = p.sessions.slice(0, 10);
  const last = p.sessions[0];
  const totalAnswers = p.daily.reduce((n, d) => n + d.n, 0);
  const maxDaily = Math.max(1, ...p.daily.map((d) => d.n));
  const retentionAll = p.retention.reduce((a, r) => ({ n: a.n + r.n, kept: a.kept + r.kept }), { n: 0, kept: 0 });
  const weakest = [...p.categories].filter((c) => c.accuracy !== null).sort((a, b) => a.accuracy! - b.accuracy!)[0];

  return (
    <>
      <PageHeader title="Progress" description="How your accuracy and retention are changing, and where to focus next." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Answers in last 60 days" value={totalAnswers} />
        <Stat
          label="Right first time"
          value={p.firstAttempt.attempted ? pct(p.firstAttempt.firstCorrect / p.firstAttempt.attempted) : "—"}
          hint={`${p.firstAttempt.firstCorrect} of ${p.firstAttempt.attempted} questions practised`}
        />
        <Stat label="Retention" value={retentionAll.n ? pct(retentionAll.kept / retentionAll.n) : "—"} hint="Still correct after a previous correct answer" />
        <Stat label="Repeatedly wrong" value={p.repeatedlyWrongCount} hint="Wrong 2+ times and wrong last time" />
      </div>

      {weakest && (
        <div className="card mt-4 flex flex-wrap items-center gap-3 p-4">
          <p className="flex-1 text-sm">
            <strong>Recommended next:</strong> {weakest.name} is your weakest category ({pct(weakest.accuracy)}).
            {p.repeatedlyWrongCount > 0 && ` You also have ${p.repeatedlyWrongCount} question${p.repeatedlyWrongCount === 1 ? "" : "s"} you keep getting wrong.`}
          </p>
          <Link href={`/practice?mode=category&category=${weakest.slug}`} className="btn btn-primary btn-sm">Practise {weakest.name}</Link>
          {p.repeatedlyWrongCount > 0 && <Link href="/practice?mode=weak" className="btn btn-sm">Weak areas</Link>}
        </div>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section title="Accuracy by category">
          <p className="mb-3 text-xs text-muted">Combines practice answers with your original mock-test results.</p>
          <div className="space-y-3">
            {p.categories.map((c) => (
              <Meter
                key={c.slug}
                label={c.name}
                value={c.accuracy}
                href={`/questions?category=${c.slug}`}
                detail={`${c.questions} questions · practice ${c.attempts ? `${c.correct}/${c.attempts}` : "none yet"} · mock ${c.mockCorrect}/${c.mockAnswered} · ${c.mastered} mastered`}
              />
            ))}
          </div>
        </Section>
        <Section title="Accuracy by mock exam">
          {p.exams.length === 0 ? (
            <p className="text-sm text-ink-2">No questions yet.</p>
          ) : (
            <div className="space-y-3">
              {p.exams.map((e) => (
                <Meter
                  key={e.exam ?? "none"}
                  label={e.exam ? `Mock test ${e.exam}` : "Not assigned to a mock exam"}
                  value={e.accuracy}
                  href={e.exam ? `/questions?exam=${e.exam}` : "/questions?exam=none"}
                  detail={`${e.questions} questions · original score ${e.mockScore ? `${e.mockScore.correct}/${e.mockScore.total}` : "—"} · practice ${pct(e.practiceAccuracy)}`}
                />
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section title="Daily practice (last 60 days)">
          {p.daily.length === 0 ? (
            <p className="text-sm text-ink-2">No practice recorded yet.</p>
          ) : (
            <>
              <div className="flex h-32 items-end gap-0.5" role="img" aria-label="Answers per day; see table below">
                {p.daily.map((d) => (
                  <div key={d.day} className="flex h-full min-w-1 flex-1 flex-col justify-end" title={`${d.day}: ${d.n} answers, ${d.correct} correct (${Math.round((d.correct / d.n) * 100)}%)`}>
                    <div className="rounded-t-[4px] bg-accent" style={{ height: `${(d.n / maxDaily) * 100}%` }} />
                  </div>
                ))}
              </div>
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-ink-2">Show as table</summary>
                <table className="mt-2 w-full text-left text-xs">
                  <thead><tr className="text-muted"><th className="py-1">Day</th><th>Answers</th><th>Accuracy</th><th>Reviews</th></tr></thead>
                  <tbody>
                    {[...p.daily].reverse().map((d) => (
                      <tr key={d.day} className="border-t border-line"><td className="py-1">{d.day}</td><td>{d.n}</td><td>{pct(d.correct / d.n)}</td><td>{d.reviews}</td></tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          )}
        </Section>
        <Section title="Retention by week">
          {p.retention.length === 0 ? (
            <p className="text-sm text-ink-2">Retention appears once you have answered questions correctly and seen them again.</p>
          ) : (
            <div className="space-y-3">
              {p.retention.map((r) => (
                <Meter key={r.week} label={`Week of ${r.week}`} value={r.kept / r.n} detail={`${r.kept} of ${r.n} previously-correct answers still correct`} />
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Section title="Frequently missed questions">
          {p.frequentlyMissed.length === 0 ? (
            <p className="text-sm text-ink-2">No missed questions yet.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {p.frequentlyMissed.map((m) => (
                <li key={m.id} className="flex items-start justify-between gap-3 py-2">
                  <div className="min-w-0">
                    <Link href={`/questions/${m.id}`} className="hover:underline">{m.prompt}</Link>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">{m.ref} <StatusBadge status={m.status as ReviewStatus} /></div>
                  </div>
                  <span className="shrink-0 tabular-nums text-bad">{m.wrong}× wrong</span>
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Session history">
          <div id="sessions" />
          {recent.length === 0 ? (
            <p className="text-sm text-ink-2">No sessions yet.</p>
          ) : (
            <>
              {last && last.change !== null && (
                <p className="mb-2 text-sm">
                  Last {last.label.toLowerCase()} session: {pct(last.accuracy)}{" "}
                  <span className={last.change >= 0 ? "text-good" : "text-bad"}>
                    ({last.change >= 0 ? "▲" : "▼"} {Math.abs(Math.round(last.change * 100))} points vs the previous one)
                  </span>
                </p>
              )}
              <table className="w-full text-left text-sm">
                <thead><tr className="text-xs text-muted"><th className="py-1">Session</th><th>Score</th><th>Change</th></tr></thead>
                <tbody>
                  {recent.map((s) => (
                    <tr key={s.id} className="border-t border-line">
                      <td className="py-2">
                        <Link href={`/practice/${s.id}`} className="link">{s.label}</Link>
                        <div className="text-xs text-muted">{new Date(s.startedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</div>
                      </td>
                      <td className="tabular-nums">{s.correct}/{s.answered} ({pct(s.accuracy)})</td>
                      <td className={`tabular-nums ${s.change === null ? "text-muted" : s.change >= 0 ? "text-good" : "text-bad"}`}>
                        {s.change === null ? "—" : `${s.change >= 0 ? "+" : "−"}${Math.abs(Math.round(s.change * 100))}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Section>
      </div>
    </>
  );
}
