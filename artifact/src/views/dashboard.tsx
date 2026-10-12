import * as React from "react";
import { useState } from "react";
import { PASS_MARK, PER_TEST, TOTAL_TESTS } from "../model";
import { categoryPerf, dailyActivity, deriveAll, pct, stylePerf, testSummaries } from "../logic";
import { Meter, PageHeader, Panel, Stat, useApp } from "../ui";
import { startTest } from "./tests";

export function Home() {
  const { store, go } = useApp();
  const [err, setErr] = useState<string | null>(null);
  const all = deriveAll(store);
  if (!all.length) {
    return (
      <>
        <PageHeader title="Welcome" sub="There are no questions yet." />
        {store.isEditor ? (
          <Panel>
            <p>Import the Word document (.docx) with the questions to create the tests.</p>
            <button className="btn btn-primary" onClick={() => go("import")}>
              Go to import
            </button>
          </Panel>
        ) : (
          <Panel>
            <p className="muted">The owner has not added any questions yet.</p>
          </Panel>
        )}
      </>
    );
  }
  const tests = testSummaries(store, all);
  const available = tests.filter((t) => t.questions > 0);
  const passed = available.filter((t) => t.last?.passed).length;
  const resume = available.find((t) => t.inProgress);
  const next = resume ?? available.find((t) => !t.last) ?? available.find((t) => !t.last?.passed);
  const attempts = all.reduce((n, d) => n + d.n, 0);
  const correct = all.reduce((n, d) => n + d.n - d.wrong, 0);
  const answered = all.filter((d) => d.n > 0).length;
  const missed = all.filter((d) => d.status === "missed").length;
  const weakest = [...categoryPerf(all), ...stylePerf(all)]
    .filter((p) => p.attempts >= 3 && p.key !== "uncategorised")
    .sort((a, b) => a.accuracy! - b.accuracy!)
    .slice(0, 5);
  const activity = dailyActivity(all, 14);
  const maxA = Math.max(1, ...activity.map((a) => a.n));

  async function takeNext() {
    if (!next) return;
    setErr(null);
    if (next.inProgress) return go("session", next.inProgress.id);
    let timed = true;
    try {
      timed = localStorage.getItem("timedTests") !== "0";
    } catch {
      /* default on */
    }
    try {
      go("session", await startTest(store, next.test, timed));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <>
      <section className="hero">
        <div className="minw0">
          <p className="eyebrow">Life in the UK test</p>
          <h1>
            {passed} of {TOTAL_TESTS} tests passed
          </h1>
          <p className="sub">
            {available.length} tests ready with {all.length} questions. Pass mark: {PASS_MARK} of {PER_TEST}.
          </p>
          <div className="row wrap mt">
            {next && (
              <button className="btn btn-primary" onClick={takeNext}>
                {next.inProgress ? `Resume Test ${next.test}` : `Take Test ${next.test}`}
              </button>
            )}
            {missed > 0 && (
              <button className="btn" onClick={() => go("retry")}>
                Retry {missed} mistake{missed === 1 ? "" : "s"}
              </button>
            )}
            <button className="btn" onClick={() => go("tests")}>
              All tests
            </button>
          </div>
          {err && <p className="err mt">{err}</p>}
        </div>
        <ol className="mini-tests" aria-label="Test progress">
          {tests.slice(0, TOTAL_TESTS).map((t) => (
            <li
              key={t.test}
              className={!t.questions ? "locked" : t.last?.passed ? "passed" : t.last ? "failed" : "ready"}
              title={`Test ${t.test}: ${!t.questions ? "coming soon" : t.last ? `${t.last.score}/${t.last.total}` : "not taken"}`}
            >
              {t.test}
            </li>
          ))}
        </ol>
      </section>

      <div className="grid4 mt-l">
        <Stat label="Questions answered" value={`${answered}/${all.length}`} hint={`${attempts} answers in total`} />
        <Stat label="Accuracy" value={pct(attempts ? correct / attempts : null)} hint={`${correct} right · ${attempts - correct} wrong`} />
        <Stat label="Mistakes to retry" value={missed} hint="Last answer was wrong" tone={missed ? "bad" : ""} />
        <Stat label="Tests passed" value={`${passed}/${available.length}`} hint={`${TOTAL_TESTS - available.length} still to come`} tone={passed ? "good" : ""} />
      </div>

      <div className="grid2 mt-l">
        <Panel title="Focus on your weak spots">
          {weakest.length === 0 ? (
            <p className="small muted">Answer a few more questions and your weakest topics and question styles will show here.</p>
          ) : (
            <div className="stack">
              {weakest.map((p) => {
                const isStyle = stylePerf(all).some((s) => s.key === p.key);
                return (
                  <Meter
                    key={p.key}
                    label={p.name}
                    value={p.accuracy}
                    detail={`${p.correct}/${p.attempts} right · ${p.questions} questions`}
                    onClick={() => go("practice", `${isStyle ? "style" : "topic"}.${p.key}`)}
                  />
                );
              })}
            </div>
          )}
        </Panel>
        <Panel title="Last 14 days">
          <div className="bars" role="img" aria-label={`Answers per day: ${activity.map((a) => a.n).join(", ")}`}>
            {activity.map((a) => (
              <div key={a.day} className="bar-col" title={`${a.day}: ${a.n} answered, ${a.correct} right`}>
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
      </div>
    </>
  );
}
