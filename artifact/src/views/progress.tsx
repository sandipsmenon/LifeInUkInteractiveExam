import * as React from "react";
import { MODES } from "../model";
import { categoryPerf, dailyActivity, deriveAll, examPerf, fmt, pct, ref, retention, sessionSummaries } from "../logic";
import { Meter, PageHeader, Panel, Stat, StatusPill, useApp } from "../ui";

export function ProgressView() {
  const { store, go } = useApp();
  const all = deriveAll(store);
  const cats = categoryPerf(all);
  const exams = examPerf(all);
  const daily = dailyActivity(all, 30);
  const maxD = Math.max(1, ...daily.map((d) => d.n));
  const ret = retention(all);
  const retAll = ret.reduce((a, r) => ({ n: a.n + r.n, kept: a.kept + r.kept }), { n: 0, kept: 0 });
  const practised = all.filter((d) => d.n > 0);
  const firstRight = practised.filter((d) => d.firstCorrect).length;
  const missed = all.filter((d) => d.wrong > 0).sort((a, b) => b.wrong - a.wrong || b.n - a.n).slice(0, 15);
  const repeated = all.filter((d) => d.wrong >= 2 && d.state.lastResult === false).length;
  const weakest = cats.filter((c) => c.accuracy !== null && c.key !== "uncategorised").sort((a, b) => a.accuracy! - b.accuracy!)[0];

  const sessions = sessionSummaries(store).filter((s) => s.answered > 0);
  const chrono = [...sessions].reverse();
  const withChange = chrono
    .map((s, i) => {
      const prev = chrono.slice(0, i).reverse().find((p) => p.mode === s.mode);
      const acc = s.correct / s.answered;
      return { ...s, acc, change: prev ? acc - prev.correct / prev.answered : null };
    })
    .reverse()
    .slice(0, 12);
  const totalAnswers = daily.reduce((n, d) => n + d.n, 0);

  return (
    <>
      <PageHeader title="Progress" sub="How your accuracy and retention are changing, and where to focus next." />
      <div className="grid4">
        <Stat label="Answers in last 30 days" value={totalAnswers} />
        <Stat label="Right first time" value={practised.length ? pct(firstRight / practised.length) : "—"} hint={`${firstRight} of ${practised.length} questions practised`} />
        <Stat label="Retention" value={retAll.n ? pct(retAll.kept / retAll.n) : "—"} hint="Still correct after a previous correct answer" />
        <Stat label="Repeatedly wrong" value={repeated} hint="Wrong 2+ times, including last time" />
      </div>
      {weakest && (
        <div className="panel row wrap mt">
          <p className="small grow">
            <strong>Recommended next:</strong> {weakest.name} is your weakest category ({pct(weakest.accuracy)}).
            {repeated > 0 && ` You also have ${repeated} question${repeated === 1 ? "" : "s"} you keep getting wrong.`}
          </p>
          <button className="btn btn-sm btn-primary" onClick={() => go("practice", `category.${weakest.key}`)}>
            Practise {weakest.name}
          </button>
          {repeated > 0 && (
            <button className="btn btn-sm" onClick={() => go("practice", "weak")}>
              Weak areas
            </button>
          )}
        </div>
      )}
      <div className="grid2 mt-l">
        <Panel title="Accuracy by category">
          <p className="tiny muted">Combines practice answers with your original mock-test results.</p>
          <div className="stack">
            {cats.map((c) => (
              <Meter
                key={c.key}
                label={c.name}
                value={c.accuracy}
                onClick={() => go("bank", `cat.${c.key}`)}
                detail={`${c.questions} questions · practice ${c.attempts ? `${c.correct}/${c.attempts}` : "none yet"} · mock ${c.mockCorrect}/${c.mockAnswered} · ${c.mastered} mastered`}
              />
            ))}
          </div>
        </Panel>
        <Panel title="Accuracy by mock exam">
          <div className="stack">
            {exams.map((e) => (
              <Meter
                key={e.key}
                label={e.name}
                value={e.accuracy}
                onClick={() => go("bank", `exam.${e.key}`)}
                detail={`${e.questions} questions · original score ${e.mockAnswered ? `${e.mockCorrect}/${e.mockAnswered}` : "—"} · practice ${pct(e.attempts ? e.correct / e.attempts : null)}`}
              />
            ))}
          </div>
        </Panel>
      </div>
      <div className="grid2 mt-l">
        <Panel title="Daily practice (last 30 days)">
          {totalAnswers === 0 ? (
            <p className="small muted">No practice recorded yet.</p>
          ) : (
            <>
              <div className="bars tall" role="img" aria-label="Answers per day; a table follows">
                {daily.map((d) => (
                  <div key={d.day} className="bar-col" title={`${d.day}: ${d.n} answers${d.n ? `, ${pct(d.correct / d.n)} correct` : ""}`}>
                    <div className="bar" style={{ height: `${(d.n / maxD) * 100}%`, minHeight: d.n ? 3 : 0 }} />
                  </div>
                ))}
              </div>
              <div className="axis">
                <span>{daily[0].day.slice(5)}</span>
                <span>Today</span>
              </div>
              <details className="mt small">
                <summary>Show as table</summary>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Day</th>
                        <th>Answers</th>
                        <th>Accuracy</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...daily].reverse().filter((d) => d.n).map((d) => (
                        <tr key={d.day}>
                          <td>{d.day}</td>
                          <td className="num">{d.n}</td>
                          <td className="num">{pct(d.correct / d.n)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          )}
        </Panel>
        <Panel title="Retention by week">
          {ret.length === 0 ? (
            <p className="small muted">This appears once you’ve answered a question correctly and then seen it again.</p>
          ) : (
            <div className="stack">
              {ret.map((r) => (
                <Meter key={r.week} label={`Week of ${r.week}`} value={r.kept / r.n} detail={`${r.kept} of ${r.n} previously correct answers still correct`} />
              ))}
            </div>
          )}
        </Panel>
      </div>
      <div className="grid2 mt-l">
        <Panel title="Frequently missed questions">
          {missed.length === 0 ? (
            <p className="small muted">No missed questions yet.</p>
          ) : (
            <ul className="list">
              {missed.map((d) => (
                <li key={d.q.id} className="list-row top">
                  <div className="minw0">
                    <button className="linkbtn left" onClick={() => go("q", d.q.id)}>
                      {d.q.prompt}
                    </button>
                    <div className="row tiny muted">
                      {ref(d.q)} <StatusPill status={d.state.status} />
                    </div>
                  </div>
                  <span className="num small bad-text nowrap">{d.wrong}× wrong</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Session history">
          {withChange.length === 0 ? (
            <p className="small muted">No sessions yet.</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Session</th>
                    <th>Score</th>
                    <th>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {withChange.map((s) => (
                    <tr key={s.id}>
                      <td>
                        <button className="linkbtn" onClick={() => go("session", s.id)}>
                          {MODES[s.mode].label}
                        </button>
                        <div className="tiny muted">{fmt(s.startedAt)}</div>
                      </td>
                      <td className="num">
                        {s.correct}/{s.answered} ({pct(s.acc)})
                      </td>
                      <td className={`num ${s.change === null ? "muted" : s.change >= 0 ? "good-text" : "bad-text"}`}>
                        {s.change === null ? "—" : `${s.change >= 0 ? "+" : "−"}${Math.abs(Math.round(s.change * 100))}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
