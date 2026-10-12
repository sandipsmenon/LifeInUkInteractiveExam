import * as React from "react";
import { useState } from "react";
import { PASS_MARK, PER_TEST, TEST_MINUTES, TOTAL_TESTS, newId, type Session } from "../model";
import { deriveAll, fmt, selectQuestions, testSummaries, type TestSummary } from "../logic";
import { PageHeader, useApp } from "../ui";
import type { Store } from "../store";

/** Starts (or resumes) one of the 40 tests and returns the session id. */
export async function startTest(store: Store, test: number, timed: boolean): Promise<string> {
  const ids = selectQuestions(deriveAll(store), { mode: "test", test });
  const s: Session = {
    id: newId(),
    mode: "test",
    test,
    label: `Test ${test}`,
    config: { timed },
    qids: ids,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    timeLimit: timed ? TEST_MINUTES * 60 : null,
  };
  await store.putSession(s);
  return s.id;
}

function stateOf(t: TestSummary) {
  if (!t.questions) return { cls: "locked", text: "Coming soon" };
  if (t.inProgress) return { cls: "progress", text: "In progress" };
  if (!t.last) return { cls: "ready", text: "Not taken" };
  return t.last.passed ? { cls: "passed", text: "Passed" } : { cls: "failed", text: "Not passed yet" };
}

export function TestsView() {
  const { store, go } = useApp();
  const [timed, setTimed] = useState(() => {
    try {
      return localStorage.getItem("timedTests") !== "0";
    } catch {
      return true;
    }
  });
  const [err, setErr] = useState<string | null>(null);
  const all = deriveAll(store);
  const tests = testSummaries(store, all);
  const available = tests.filter((t) => t.questions > 0).length;
  const passed = tests.filter((t) => t.last?.passed).length;
  const lastAt = tests.flatMap((t) => t.attempts).sort((a, b) => b.at.localeCompare(a.at))[0]?.at ?? null;

  async function open(t: TestSummary) {
    setErr(null);
    if (t.inProgress) return go("session", t.inProgress.id);
    try {
      go("session", await startTest(store, t.test, timed));
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="The 40 tests"
        sub={`${available} of ${TOTAL_TESTS} tests are ready, ${PER_TEST} questions each. Like the real exam you need ${PASS_MARK} of ${PER_TEST} (75%) to pass. Answers are marked when you submit, then you get memory tips for anything you missed.`}
      />
      <div className="row wrap mb">
        <label className="row small">
          <input
            type="checkbox"
            checked={timed}
            onChange={(e) => {
              setTimed(e.target.checked);
              try {
                localStorage.setItem("timedTests", e.target.checked ? "1" : "0");
              } catch {
                /* preference only */
              }
            }}
          />
          Exam timer ({TEST_MINUTES} minutes)
        </label>
        <span className="small muted push">
          {passed} passed · {available - passed} to go
        </span>
      </div>
      {err && (
        <p className="err mb" role="alert">
          {err}
        </p>
      )}
      <ol className="test-grid">
        {tests.slice(0, Math.max(TOTAL_TESTS, available)).map((t) => {
          const st = stateOf(t);
          return (
            <li key={t.test}>
              <button className={`test-card ${st.cls}`} disabled={!t.questions} onClick={() => open(t)} aria-label={`Test ${t.test}: ${st.text}`}>
                <span className="test-no">{t.test}</span>
                <span className="test-state">{st.text}</span>
                {t.questions > 0 && (
                  <span className="test-meta">
                    {t.last ? `Last ${t.last.score}/${t.last.total}` : `${t.questions} questions`}
                    {t.best !== null && t.attempts.length > 1 ? ` · best ${t.best}` : ""}
                  </span>
                )}
                {t.questions > 0 && t.questions < PER_TEST && <span className="test-meta warn-text">Only {t.questions} so far</span>}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="tiny muted mt">
        New tests appear as more questions are imported. Questions keep the order of the source document: questions 1–24 are Test 1, 25–48 Test 2, and so on.
        {lastAt && ` Last test taken ${fmt(lastAt)}.`}
      </p>
    </>
  );
}
