import * as React from "react";
import { PASS_MARK, PER_TEST } from "../model";
import { categoryPerf, dailyActivity, deriveAll, fmt, pct, ref, stylePerf, testSummaries } from "../logic";
import { Meter, PageHeader, Panel, Stat, StatusPill, useApp } from "../ui";

export function ProgressView() {
  const { store, go } = useApp();
  const all = deriveAll(store);
  const tests = testSummaries(store, all).filter((t) => t.questions > 0);
  const taken = tests.filter((t) => t.last);
  const passed = taken.filter((t) => t.last!.passed).length;
  const attempts = all.reduce((n, d) => n + d.n, 0);
  const correct = all.reduce((n, d) => n + d.n - d.wrong, 0);
  const practised = all.filter((d) => d.n > 0);
  const firstRight = practised.filter((d) => d.attempts[0].ok).length;
  const fixed = all.filter((d) => d.status === "learned" && d.wrong > 0).length;
  const missed = all.filter((d) => d.status === "missed").length;
  const mostMissed = all.filter((d) => d.wrong > 0).sort((a, b) => b.wrong - a.wrong || b.n - a.n).slice(0, 12);
  const daily = dailyActivity(all, 30);
  const maxD = Math.max(1, ...daily.map((d) => d.n));
  const totalDaily = daily.reduce((n, d) => n + d.n, 0);

  return (
    <>
      <PageHeader title="Progress" sub="Your test scores, the question styles and topics you find hardest, and how your mistakes are getting fixed." />
      <div className="grid4">
        <Stat label="Tests passed" value={`${passed}/${tests.length}`} hint={`${taken.length} taken at least once`} tone={passed ? "good" : ""} />
        <Stat label="Accuracy" value={pct(attempts ? correct / attempts : null)} hint={`${attempts} answers`} />
        <Stat label="Right first time" value={practised.length ? pct(firstRight / practised.length) : "—"} hint={`${firstRight} of ${practised.length} questions`} />
        <Stat label="Mistakes fixed" value={fixed} hint={`${missed} still to retry`} tone={missed ? "bad" : ""} />
      </div>

      <Panel title="Test scores" className="mt-l">
        {taken.length === 0 ? (
          <p className="small muted">No tests taken yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Test</th>
                  <th>Last score</th>
                  <th>Best</th>
                  <th>Attempts</th>
                  <th>Result</th>
                </tr>
              </thead>
              <tbody>
                {taken.map((t) => (
                  <tr key={t.test}>
                    <td>
                      <button className="linkbtn" onClick={() => go("session", t.attempts[t.attempts.length - 1].id)}>
                        Test {t.test}
                      </button>
                      <div className="tiny muted">{fmt(t.attempts[t.attempts.length - 1].at)}</div>
                    </td>
                    <td className="num">
                      {t.last!.score}/{t.last!.total}
                    </td>
                    <td className="num">{t.best}</td>
                    <td className="num">{t.attempts.length}</td>
                    <td className={t.last!.passed ? "good-text strong" : "bad-text"}>{t.last!.passed ? "Pass" : `Needs ${Math.ceil((t.last!.total * PASS_MARK) / PER_TEST)}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <div className="grid2 mt-l">
        <Panel title="By question style">
          <div className="stack">
            {stylePerf(all).map((p) => (
              <Meter
                key={p.key}
                label={p.name}
                value={p.accuracy}
                onClick={() => go("practice", `style.${p.key}`)}
                detail={`${p.answered}/${p.questions} answered${p.attempts ? ` · ${p.correct}/${p.attempts} right` : ""}${p.missed ? ` · ${p.missed} to retry` : ""}`}
              />
            ))}
          </div>
        </Panel>
        <Panel title="By topic">
          <div className="stack">
            {categoryPerf(all).map((p) => (
              <Meter
                key={p.key}
                label={p.name}
                value={p.accuracy}
                onClick={() => go("practice", `topic.${p.key}`)}
                detail={`${p.answered}/${p.questions} answered${p.attempts ? ` · ${p.correct}/${p.attempts} right` : ""}${p.missed ? ` · ${p.missed} to retry` : ""}`}
              />
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid2 mt-l">
        <Panel title="Most missed questions">
          {mostMissed.length === 0 ? (
            <p className="small muted">Nothing missed yet.</p>
          ) : (
            <ul className="list">
              {mostMissed.map((d) => (
                <li key={d.q.id} className="list-row top">
                  <div className="minw0">
                    <button className="linkbtn left" onClick={() => go("q", d.q.id)}>
                      {d.q.prompt}
                    </button>
                    <div className="row tiny muted">
                      {ref(d.q)} <StatusPill status={d.status} />
                    </div>
                  </div>
                  <span className="num small bad-text nowrap">{d.wrong}× wrong</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <Panel title="Daily practice (last 30 days)">
          {totalDaily === 0 ? (
            <p className="small muted">No answers in the last 30 days.</p>
          ) : (
            <>
              <div className="bars tall" role="img" aria-label="Answers per day; a table follows">
                {daily.map((d) => (
                  <div key={d.day} className="bar-col" title={`${d.day}: ${d.n} answers${d.n ? `, ${pct(d.correct / d.n)} right` : ""}`}>
                    <div className="bar" style={{ height: `${(d.n / maxD) * 100}%`, minHeight: d.n ? 3 : 0 }} />
                  </div>
                ))}
              </div>
              <div className="axis">
                <span>{daily[0].day.slice(5)}</span>
                <span>Today</span>
              </div>
              <details className="small mt">
                <summary>Show as table</summary>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Day</th>
                        <th>Answers</th>
                        <th>Right</th>
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
      </div>
    </>
  );
}
