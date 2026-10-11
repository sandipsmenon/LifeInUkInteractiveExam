import * as React from "react";
import { MODES } from "../model";
import { categoryPerf, dailyActivity, deriveAll, fmt, pct, sessionSummaries, topicPerf } from "../logic";
import { Meter, PageHeader, Panel, Stat, useApp } from "../ui";
import { setBankFilter } from "./bank";

export function Dashboard() {
  const { store, go } = useApp();
  const all = deriveAll(store);
  const now = new Date();
  if (!all.length) {
    return (
      <>
        <PageHeader title="Welcome" sub="Your question bank is empty." />
        <Panel>
          <p>Import the Word document (.docx) with your mock-test questions to get started. You will review everything before it is saved.</p>
          <button className="btn btn-primary" onClick={() => go("import")}>
            Go to import
          </button>
        </Panel>
      </>
    );
  }
  const attempts = all.reduce((n, d) => n + d.n, 0);
  const correct = all.reduce((n, d) => n + d.n - d.wrong, 0);
  const mockAnswered = all.filter((d) => d.q.sourceResult).length;
  const mockCorrect = all.filter((d) => d.q.sourceResult === "correct").length;
  const exams = new Set(all.filter((d) => d.q.exam).map((d) => d.q.exam)).size;
  const unassigned = all.filter((d) => !d.q.exam).length;
  const practised = all.filter((d) => d.n > 0).length;
  const due = all.filter((d) => d.n > 0 && d.state.dueAt && d.state.dueAt <= now).length;
  const status = { new: 0, learning: 0, needs_revision: 0, mastered: 0 } as Record<string, number>;
  for (const d of all) status[d.state.status]++;
  const flags = all.filter((d) => d.q.flags.some((f) => !f.resolvedAt)).length;
  const weakestCats = categoryPerf(all)
    .filter((c) => c.accuracy !== null && c.key !== "uncategorised")
    .sort((a, b) => a.accuracy! - b.accuracy!)
    .slice(0, 4);
  const weakestTopics = topicPerf(all)
    .filter((t) => t.questions >= 2 && t.accuracy !== null)
    .sort((a, b) => a.accuracy! - b.accuracy!)
    .slice(0, 5);
  const sessions = sessionSummaries(store);
  const resume = sessions.find((s) => !s.finished && s.answered < s.total && now.getTime() - new Date(s.startedAt).getTime() < 7 * 86_400_000);
  const activity = dailyActivity(all, 14);
  const maxA = Math.max(1, ...activity.map((a) => a.n));
  const lastExam = sessions.find((s) => s.mode === "exam" && s.finished);

  const recs: { title: string; detail: string; act: () => void }[] = [];
  if (due) recs.push({ title: `Review ${due} due question${due === 1 ? "" : "s"}`, detail: "Spaced repetition says these are about to be forgotten.", act: () => go("practice", "revision") });
  if (status.needs_revision)
    recs.push({
      title: `Fix ${status.needs_revision} question${status.needs_revision === 1 ? "" : "s"} you got wrong`,
      detail: "Weak-areas mode puts your most-missed questions first and explains why.",
      act: () => go("practice", "weak"),
    });
  if (weakestCats[0])
    recs.push({
      title: `Practise ${weakestCats[0].name}`,
      detail: `Your weakest category at ${pct(weakestCats[0].accuracy)} (practice + mock results).`,
      act: () => go("practice", `category.${weakestCats[0].key}`),
    });
  if (all.length - practised > 0)
    recs.push({
      title: `Try ${all.length - practised} question${all.length - practised === 1 ? "" : "s"} you haven't practised`,
      detail: "Questions you got wrong in your mock tests come first in Weak areas.",
      act: () => go("practice", "weak"),
    });
  if (all.length >= 24 && attempts >= 50 && (!lastExam || now.getTime() - new Date(lastExam.startedAt).getTime() > 7 * 86_400_000))
    recs.push({ title: "Take an exam simulation", detail: "Check your readiness under real exam timing.", act: () => go("practice", "exam") });
  if (unassigned)
    recs.push({
      title: `Assign ${unassigned} question${unassigned === 1 ? "" : "s"} to a mock exam`,
      detail: "Your document did not say where each mock test starts.",
      act: () => go("bank", "exam.none"),
    });
  if (flags)
    recs.push({ title: `Check ${flags} flagged question${flags === 1 ? "" : "s"}`, detail: "Possible source errors or confusing questions.", act: () => go("bank", "mark.flagged") });

  return (
    <>
      <PageHeader
        title="Dashboard"
        sub={`${all.length} questions in your bank. Every figure comes from your own answers.`}
        actions={
          <>
            {resume && (
              <button className="btn btn-primary" onClick={() => go("session", resume.id)}>
                Resume {MODES[resume.mode].label.toLowerCase()} ({resume.answered}/{resume.total})
              </button>
            )}
            <button className={`btn ${resume ? "" : "btn-primary"}`} onClick={() => go("practice", due ? "revision" : "weak")}>
              {due ? `Review ${due} due` : "Practise weak areas"}
            </button>
          </>
        }
      />
      <div className="grid4">
        <Stat label="Questions in bank" value={all.length} hint={`${practised} practised so far`} />
        <Stat label="Mock exams imported" value={exams} hint={unassigned ? `${unassigned} not assigned to an exam yet` : "of up to 40"} />
        <Stat label="Practice accuracy" value={pct(attempts ? correct / attempts : null)} hint={`${correct} correct · ${attempts - correct} incorrect`} />
        <Stat label="Original mock results" value={mockAnswered ? `${mockCorrect}/${mockAnswered}` : "—"} hint="As recorded in your document" />
      </div>
      <div className="grid4 mt">
        {(
          [
            ["mastered", "Mastered", "good"],
            ["learning", "Learning", "accent"],
            ["needs_revision", "Needs revision", "bad"],
            ["new", "Not practised yet", ""],
          ] as const
        ).map(([k, l, tone]) => (
          <button key={k} className="stat stat-btn" onClick={() => go("bank", `status.${k}`)}>
            <div className="stat-label">{l}</div>
            <div className={`stat-value ${tone}`}>{status[k]}</div>
          </button>
        ))}
      </div>

      <div className="grid-main mt-l">
        <Panel title="What to study next">
          {recs.length === 0 ? (
            <p className="muted">You’re up to date. An exam simulation will show how ready you are.</p>
          ) : (
            <ol className="recs">
              {recs.slice(0, 5).map((r, i) => (
                <li key={r.title}>
                  <span className="rec-n" aria-hidden>
                    {i + 1}
                  </span>
                  <div className="minw0 grow">
                    <div className="strong">{r.title}</div>
                    <div className="small muted">{r.detail}</div>
                  </div>
                  <button className="btn btn-sm" onClick={r.act}>
                    Start
                  </button>
                </li>
              ))}
            </ol>
          )}
        </Panel>
        <Panel title="Weakest categories">
          <div className="stack">
            {weakestCats.map((c) => (
              <Meter
                key={c.key}
                label={c.name}
                value={c.accuracy}
                onClick={() => go("practice", `category.${c.key}`)}
                detail={`${c.correct + c.mockCorrect}/${c.attempts + c.mockAnswered} right (practice + mock) · ${c.questions} questions`}
              />
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid3 mt-l">
        <Panel title="Weakest topics">
          <div className="stack">
            {weakestTopics.length === 0 && <p className="muted small">No topic data yet.</p>}
            {weakestTopics.map((t) => (
              <Meter
                key={t.key}
                label={t.name}
                value={t.accuracy}
                detail={`${t.questions} questions`}
                onClick={() => {
                  setBankFilter({ topic: t.key });
                  go("bank");
                }}
              />
            ))}
          </div>
        </Panel>
        <Panel title="Last 14 days">
          <div className="bars" role="img" aria-label={`Answers per day over the last 14 days: ${activity.map((a) => a.n).join(", ")}`}>
            {activity.map((a) => (
              <div key={a.day} className="bar-col" title={`${a.day}: ${a.n} answered, ${a.correct} correct`}>
                <div className="bar" style={{ height: `${(a.n / maxA) * 100}%`, minHeight: a.n ? 3 : 0 }} />
              </div>
            ))}
          </div>
          <div className="axis">
            <span>{activity[0].day.slice(5)}</span>
            <span>Today</span>
          </div>
          <p className="small muted">{activity.reduce((n, a) => n + a.n, 0)} answers in the last two weeks.</p>
        </Panel>
        <Panel title="Recent practice">
          {sessions.length === 0 ? (
            <p className="muted small">No practice yet.</p>
          ) : (
            <ul className="list">
              {sessions.slice(0, 6).map((s) => (
                <li key={s.id} className="list-row">
                  <div className="minw0">
                    <button className="linkbtn" onClick={() => go("session", s.id)}>
                      {MODES[s.mode].label}
                    </button>
                    <div className="tiny muted">{fmt(s.startedAt)}</div>
                  </div>
                  <span className="num small">
                    {s.correct}/{s.answered}
                    {!s.finished && s.answered < s.total ? " · unfinished" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}
