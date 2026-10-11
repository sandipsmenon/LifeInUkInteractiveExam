import Link from "next/link";
import { Meter, PageHeader, Section, Stat, pct } from "@/components/ui";
import { latestUnfinishedSession } from "@/lib/server/practice";
import { dashboardStats } from "@/lib/server/stats";
import { MODES } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function Dashboard() {
  const [s, resume] = await Promise.all([dashboardStats(), latestUnfinishedSession()]);
  const t = s.totals;
  const maxActivity = Math.max(1, ...s.activity.map((a) => a.n));

  if (t.questions === 0) {
    return (
      <>
        <PageHeader title="Welcome" description="Your question bank is empty. Start by importing your Word document of mock-test questions." />
        <div className="card flex flex-col items-start gap-3 p-6">
          <p className="text-sm text-ink-2">
            Your initial dataset (mock tests 1–3, 75 questions) is bundled with the app. Review it and import it in one step, or upload a new
            <code> .docx</code>.
          </p>
          <Link href="/import" className="btn btn-primary">Go to import</Link>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`${t.questions} questions from ${t.batches} import${t.batches === 1 ? "" : "s"}. All figures come from your own answers.`}
        actions={
          <>
            {resume && (
              <Link href={`/practice/${resume.id}`} className="btn btn-primary">
                Resume {MODES[resume.mode]?.label.toLowerCase()} ({resume.answered}/{resume.total})
              </Link>
            )}
            <Link href={t.due > 0 ? "/practice?mode=revision" : "/practice?mode=weak"} className={`btn ${resume ? "" : "btn-primary"}`}>
              {t.due > 0 ? `Review ${t.due} due` : "Practise weak areas"}
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Questions in bank" value={t.questions} hint={`${t.practised} practised so far`} />
        <Stat
          label="Mock exams imported"
          value={t.exams}
          hint={t.unassigned ? <Link className="link" href="/questions?exam=none">{t.unassigned} not yet assigned to an exam</Link> : "of up to 40"}
        />
        <Stat label="Practice accuracy" value={pct(t.accuracy)} hint={`${t.correct} correct · ${t.incorrect} incorrect`} />
        <Stat
          label="Original mock results"
          value={t.mockAnswered ? `${t.mockCorrect}/${t.mockAnswered}` : "—"}
          hint="As recorded in your document"
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Link href="/questions?status=mastered" className="card p-4 hover:bg-surface-2">
          <div className="text-xs font-medium text-ink-2">Mastered</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-good">{s.status.mastered}</div>
        </Link>
        <Link href="/questions?status=learning" className="card p-4 hover:bg-surface-2">
          <div className="text-xs font-medium text-ink-2">Learning</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-accent">{s.status.learning}</div>
        </Link>
        <Link href="/questions?status=needs_revision" className="card p-4 hover:bg-surface-2">
          <div className="text-xs font-medium text-ink-2">Needs revision</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-bad">{s.status.needs_revision}</div>
        </Link>
        <Link href="/questions?status=new" className="card p-4 hover:bg-surface-2">
          <div className="text-xs font-medium text-ink-2">Not practised yet</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums">{s.status.new}</div>
        </Link>
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Section title="What to study next">
            {s.recommendations.length === 0 ? (
              <p className="text-sm text-ink-2">You are up to date. Try an exam simulation to check your readiness.</p>
            ) : (
              <ol className="divide-y divide-line">
                {s.recommendations.map((r, i) => (
                  <li key={r.title} className="flex items-center gap-3 py-3">
                    <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">{r.title}</div>
                      <div className="text-sm text-ink-2">{r.detail}</div>
                    </div>
                    <Link href={r.href} className="btn btn-sm shrink-0">Start</Link>
                  </li>
                ))}
              </ol>
            )}
          </Section>
        </div>
        <Section title="Weakest categories" action={<Link href="/progress" className="link text-sm">All</Link>}>
          {s.weakestCategories.length === 0 ? (
            <p className="text-sm text-ink-2">Practise a few questions to see your weak spots.</p>
          ) : (
            <div className="space-y-3">
              {s.weakestCategories.map((c) => (
                <Meter
                  key={c.slug}
                  label={c.name}
                  value={c.accuracy}
                  href={`/practice?mode=category&category=${c.slug}`}
                  detail={`${c.correct + c.mockCorrect}/${c.attempts + c.mockAnswered} right (practice + mock) · ${c.questions} questions`}
                />
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Section title="Weakest topics">
          {s.weakestTopics.length === 0 ? (
            <p className="text-sm text-ink-2">No topic data yet.</p>
          ) : (
            <ul className="space-y-3">
              {s.weakestTopics.map((t) => (
                <li key={t.topic}>
                  <Meter label={t.topic} value={t.accuracy} href={`/questions?topic=${encodeURIComponent(t.topic)}`} detail={`${t.questions} questions`} />
                </li>
              ))}
            </ul>
          )}
        </Section>
        <Section title="Last 14 days">
          <div className="flex h-28 items-end gap-1" role="img" aria-label="Questions answered per day over the last 14 days">
            {s.activity.map((a) => (
              <div key={a.day} className="group relative flex h-full flex-1 flex-col justify-end" title={`${a.day}: ${a.n} answered, ${a.correct} correct`}>
                <div className="rounded-t-[4px] bg-accent" style={{ height: `${(a.n / maxActivity) * 100}%`, minHeight: a.n ? 3 : 0 }} />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-xs text-muted">
            <span>{s.activity[0]?.day.slice(5)}</span>
            <span>Today</span>
          </div>
          <p className="mt-2 text-xs text-ink-2">
            {s.activity.reduce((n, a) => n + a.n, 0)} answers in the last two weeks. Hover a bar for the day.
          </p>
        </Section>
        <Section title="Recent practice" action={<Link href="/progress#sessions" className="link text-sm">History</Link>}>
          {s.recent.length === 0 ? (
            <p className="text-sm text-ink-2">No practice yet. <Link href="/practice" className="link">Start a session</Link>.</p>
          ) : (
            <ul className="divide-y divide-line text-sm">
              {s.recent.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <Link href={`/practice/${r.id}`} className="link">{r.label}</Link>
                    <div className="text-xs text-muted">{new Date(r.startedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</div>
                  </div>
                  <span className="tabular-nums text-ink-2">
                    {r.correct}/{r.answered}
                    {!r.finished && r.answered < r.total ? " · unfinished" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
