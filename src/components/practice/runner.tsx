"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlagButton } from "@/components/flag-button";
import { api, seededShuffle, storage } from "@/lib/client";
import type { SessionData, sessionResults } from "@/lib/server/practice";
import { EXAM_FORMAT, MODES, STATUS_LABEL, type AttemptFeedback, type PracticeQuestion } from "@/lib/types";

type Results = Awaited<ReturnType<typeof sessionResults>>;
type Confidence = 1 | 2 | 3;

interface Props {
  session: SessionData;
  initialResults: Results | null;
}

export function PracticeRunner({ session, initialResults }: Props) {
  const [results, setResults] = useState<Results | null>(initialResults);
  if (results) return <Summary session={session} results={results} />;
  if (session.mode === "exam") return <ExamRunner session={session} onDone={setResults} />;
  return <StudyRunner session={session} onDone={setResults} />;
}

function orderedOptions(q: PracticeQuestion, sessionId: string) {
  return q.questionType === "true_false" ? q.options : seededShuffle(q.options, sessionId + q.id);
}

function Progress({ index, total, correct, answered }: { index: number; total: number; correct?: number; answered: number }) {
  return (
    <div className="mb-4">
      <div className="mb-1 flex justify-between text-xs text-ink-2">
        <span>
          Question {Math.min(index + 1, total)} of {total}
        </span>
        {correct !== undefined && (
          <span className="tabular-nums">
            {correct}/{answered} correct
          </span>
        )}
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered}>
        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(answered / total) * 100}%` }} />
      </div>
    </div>
  );
}

function QuestionHeader({ q }: { q: PracticeQuestion }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-ink-2">
      <span className="chip">{q.ref}</span>
      {q.categories.slice(0, 3).map((c) => (
        <span key={c} className="chip">{c}</span>
      ))}
      {q.questionType === "multi" && <span className="chip border-warn bg-warn-soft text-warn">Choose {q.correctCount}</span>}
    </div>
  );
}

// ---------------------------------------------------------------- study modes (immediate feedback)

function StudyRunner({ session, onDone }: { session: SessionData; onDone: (r: Results) => void }) {
  const qs = session.questions;
  const firstUnanswered = qs.findIndex((q) => !session.answered[q.id]);
  const [index, setIndex] = useState(firstUnanswered === -1 ? qs.length - 1 : firstUnanswered);
  const [answered, setAnswered] = useState(session.answered);
  const [selected, setSelected] = useState<string[]>([]);
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [askConfidence, setAskConfidence] = useState(true);
  const [revealed, setRevealed] = useState(false); // answer shown without being checked (self-mark next)
  const [feedback, setFeedback] = useState<AttemptFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shownAt = useRef(0);
  const rapid = session.mode === "rapid";
  const q = qs[index];
  const options = useMemo(() => (q ? orderedOptions(q, session.id) : []), [q, session.id]);

  useEffect(() => {
    const v = storage()?.getItem("askConfidence");
    // Read after mount so server and client render the same markup first.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (v !== null && v !== undefined) setAskConfidence(v === "1");
  }, []);
  useEffect(() => {
    shownAt.current = Date.now();
  }, [index]);

  const correctSoFar = Object.values(answered).filter((a) => a.isCorrect).length;
  const answeredCount = Object.keys(answered).length;

  const submit = useCallback(
    async (payload: { selectedKeys?: string[]; selfMarkedCorrect?: boolean }) => {
      if (!q) return;
      setBusy(true);
      setError(null);
      try {
        const fb = await api<AttemptFeedback>("/api/practice/attempts", {
          sessionId: session.id,
          questionId: q.id,
          mode: session.mode,
          selectedKeys: payload.selectedKeys ?? [],
          selfMarkedCorrect: payload.selfMarkedCorrect,
          confidence: askConfidence ? confidence : null,
          responseMs: Date.now() - shownAt.current,
        });
        setFeedback(fb);
        setAnswered((a) => ({ ...a, [q.id]: { isCorrect: fb.isCorrect, selectedKeys: payload.selectedKeys ?? [] } }));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [q, session.id, session.mode, askConfidence, confidence],
  );

  async function revealForSelfMark() {
    // Reveal needs the correct keys without recording anything yet: fetch from the question API.
    setBusy(true);
    try {
      const detail = await api<{ correctKeys: string[]; explanation: string | null; memoryAid: string | null }>(`/api/questions/${q.id}`);
      setRevealed(true);
      setFeedback({
        isCorrect: false,
        correctKeys: detail.correctKeys,
        explanation: detail.explanation,
        memoryAid: detail.memoryAid,
        status: "new",
        nextDueAt: null,
        intervalDays: 0,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function selfMark(knew: boolean) {
    setRevealed(false);
    await submit({ selfMarkedCorrect: knew });
  }

  async function override(isCorrect: boolean) {
    setBusy(true);
    try {
      const res = await api<{ status: AttemptFeedback["status"]; nextDueAt: string | null }>("/api/practice/attempts/override", {
        questionId: q.id,
        sessionId: session.id,
        isCorrect,
      });
      setFeedback((f) => (f ? { ...f, isCorrect, status: res.status, nextDueAt: res.nextDueAt } : f));
      setAnswered((a) => ({ ...a, [q.id]: { ...a[q.id], isCorrect } }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function next() {
    if (index + 1 >= qs.length) {
      setBusy(true);
      try {
        const res = await api<{ results: Results }>(`/api/practice/sessions/${session.id}/finish`, {});
        onDone(res.results);
      } catch (err) {
        setError((err as Error).message);
        setBusy(false);
      }
      return;
    }
    setIndex(index + 1);
    setSelected([]);
    setConfidence(null);
    setFeedback(null);
    setRevealed(false);
    window.scrollTo({ top: 0 });
  }

  function toggle(key: string) {
    if (feedback) return;
    if (q.questionType === "multi") setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));
    else setSelected([key]);
  }

  // Keyboard: 1–9 choose an option, Enter checks / continues.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const n = Number(e.key);
      if (!rapid && n >= 1 && n <= options.length && !feedback) toggle(options[n - 1].key);
      if (e.key === "Enter" && !busy) {
        if (feedback && !revealed) next();
        else if (!feedback && selected.length && !rapid) submit({ selectedKeys: selected });
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!q) return <p>This session has no questions.</p>;
  const isMarked = feedback && !revealed;
  const correctText = feedback ? options.filter((o) => feedback.correctKeys.includes(o.key)).map((o) => o.text) : [];

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">{MODES[session.mode].label}</h1>
        <Link href="/practice" className="text-sm text-ink-2 hover:underline">Exit</Link>
      </div>
      <Progress index={index} total={qs.length} correct={correctSoFar} answered={answeredCount} />

      <article className="card p-4 sm:p-6" aria-live="polite">
        <QuestionHeader q={q} />
        {q.reasons && q.reasons.length > 0 && (
          <details className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-sm text-warn">
            <summary className="cursor-pointer font-medium">Why this question?</summary>
            <ul className="mt-1 list-disc pl-5">
              {q.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </details>
        )}
        <h2 className="text-lg font-medium leading-snug sm:text-xl">{q.prompt}</h2>

        {rapid ? (
          <div className="mt-5">
            {!feedback ? (
              <button className="btn btn-primary w-full" onClick={revealForSelfMark} disabled={busy}>
                Show answer
              </button>
            ) : (
              <div className="rounded-lg border border-line bg-surface-2 p-4">
                <div className="text-xs text-ink-2">Answer</div>
                <div className="mt-1 text-lg font-semibold">{correctText.join("; ")}</div>
              </div>
            )}
          </div>
        ) : (
          <ul className="mt-5 space-y-2" role={q.questionType === "multi" ? "group" : "radiogroup"} aria-label="Answer options">
            {options.map((o, i) => {
              const isSel = selected.includes(o.key);
              const isRight = feedback?.correctKeys.includes(o.key);
              let style = isSel ? "border-accent bg-accent-soft" : "hover:bg-surface-2";
              if (feedback) {
                if (isRight) style = "border-good bg-good-soft";
                else if (isSel) style = "border-bad bg-bad-soft";
                else style = "opacity-70";
              }
              return (
                <li key={o.key}>
                  <button
                    type="button"
                    role={q.questionType === "multi" ? "checkbox" : "radio"}
                    aria-checked={isSel}
                    disabled={!!feedback}
                    onClick={() => toggle(o.key)}
                    className={`flex min-h-12 w-full items-center gap-3 rounded-lg border border-line px-3 py-2 text-left text-[15px] ${style}`}
                  >
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded border border-line text-xs text-ink-2">{i + 1}</span>
                    <span className="flex-1">{o.text}</span>
                    {feedback && isRight && <span className="text-xs font-semibold text-good">Correct answer</span>}
                    {feedback && isSel && !isRight && <span className="text-xs font-semibold text-bad">Your answer</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {!feedback && !rapid && askConfidence && (
          <fieldset className="mt-4">
            <legend className="label">How sure are you? (optional)</legend>
            <div className="flex gap-2">
              {([
                [1, "Guessing"],
                [2, "Unsure"],
                [3, "Sure"],
              ] as const).map(([v, l]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={confidence === v}
                  onClick={() => setConfidence(confidence === v ? null : v)}
                  className={`btn btn-sm flex-1 ${confidence === v ? "border-accent bg-accent-soft text-accent" : ""}`}
                >
                  {l}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {error && <p role="alert" className="mt-3 text-sm text-bad">{error}</p>}

        {!feedback && !rapid && (
          <div className="mt-5 flex flex-wrap gap-2">
            <button className="btn btn-primary flex-1" disabled={!selected.length || busy} onClick={() => submit({ selectedKeys: selected })}>
              Check answer
            </button>
            <button className="btn" disabled={busy} onClick={revealForSelfMark}>
              I don&apos;t know — reveal
            </button>
          </div>
        )}

        {revealed && (
          <div className="mt-5">
            <p className="mb-2 text-sm text-ink-2">Did you know it?</p>
            <div className="flex gap-2">
              <button className="btn flex-1 border-good text-good" disabled={busy} onClick={() => selfMark(true)}>
                I knew it
              </button>
              <button className="btn flex-1 border-bad text-bad" disabled={busy} onClick={() => selfMark(false)}>
                I didn&apos;t know
              </button>
            </div>
          </div>
        )}

        {isMarked && (
          <div className="mt-5 space-y-3">
            <div className={`rounded-lg px-3 py-2 font-medium ${feedback.isCorrect ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`} role="status">
              {feedback.isCorrect ? "Correct" : `Incorrect — the answer is: ${correctText.join("; ")}`}
            </div>
            {feedback.explanation && <p className="text-sm leading-relaxed text-ink-2">{feedback.explanation}</p>}
            {feedback.memoryAid && (
              <p className="rounded-lg bg-accent-soft px-3 py-2 text-sm text-accent">
                <strong>Memory aid:</strong> {feedback.memoryAid}
              </p>
            )}
            <p className="text-xs text-muted">
              Status: {STATUS_LABEL[feedback.status]}
              {feedback.nextDueAt &&
                ` · next review ${feedback.intervalDays >= 1 ? `in ${feedback.intervalDays} day${feedback.intervalDays === 1 ? "" : "s"}` : "soon"}`}
              {" · "}
              <button className="underline" disabled={busy} onClick={() => override(!feedback.isCorrect)}>
                {feedback.isCorrect ? "Actually I got this wrong" : "Mark as correct instead"}
              </button>
            </p>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-2 border-t border-line pt-4">
          <div className="flex items-center gap-2">
            <FlagButton key={q.id} questionId={q.id} />
            <Link href={`/questions/${q.id}`} target="_blank" className="text-xs text-ink-2 hover:underline">
              Edit / notes ↗
            </Link>
          </div>
          {isMarked ? (
            <button className="btn btn-primary" onClick={next} disabled={busy} autoFocus>
              {index + 1 >= qs.length ? "Finish" : "Next"}
            </button>
          ) : (
            !rapid && (
              <label className="flex items-center gap-2 text-xs text-ink-2">
                <input
                  type="checkbox"
                  checked={askConfidence}
                  onChange={(e) => {
                    setAskConfidence(e.target.checked);
                    storage()?.setItem("askConfidence", e.target.checked ? "1" : "0");
                  }}
                />
                Ask confidence
              </label>
            )
          )}
        </div>
      </article>
      <p className="mt-3 hidden text-center text-xs text-muted sm:block">Keys: 1–{Math.max(options.length, 2)} choose · Enter check / next</p>
    </div>
  );
}

// ---------------------------------------------------------------- exam simulation (timed, marked at the end)

function ExamRunner({ session, onDone }: { session: SessionData; onDone: (r: Results) => void }) {
  const qs = session.questions;
  const storeKey = `exam:${session.id}`;
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitted = useRef(false);
  const deadline = new Date(session.startedAt).getTime() + (session.timeLimitSeconds ?? EXAM_FORMAT.minutes * 60) * 1000;
  const remaining = Math.max(0, deadline - now);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(storeKey);
      // Restores in-progress exam answers after a refresh (browser-only storage, read after mount).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (saved) setAnswers(JSON.parse(saved));
    } catch {}
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [storeKey]);

  const save = (next: Record<string, string[]>) => {
    setAnswers(next);
    try {
      sessionStorage.setItem(storeKey, JSON.stringify(next));
    } catch {}
  };

  const submitExam = useCallback(async () => {
    if (submitted.current) return;
    submitted.current = true;
    setBusy(true);
    setError(null);
    try {
      await api("/api/practice/attempts", {
        attempts: qs.map((q) => ({ sessionId: session.id, questionId: q.id, mode: "exam", selectedKeys: answers[q.id] ?? [] })),
      });
      const res = await api<{ results: Results }>(`/api/practice/sessions/${session.id}/finish`, {});
      try {
        sessionStorage.removeItem(storeKey);
      } catch {}
      onDone(res.results);
    } catch (err) {
      submitted.current = false;
      setBusy(false);
      setError((err as Error).message);
    }
  }, [answers, qs, session.id, storeKey, onDone]);

  useEffect(() => {
    if (remaining === 0 && !submitted.current) submitExam();
  }, [remaining, submitExam]);

  const q = qs[index];
  const options = useMemo(() => orderedOptions(q, session.id), [q, session.id]);
  const sel = answers[q.id] ?? [];
  const answeredCount = qs.filter((x) => (answers[x.id] ?? []).length).length;
  const mm = Math.floor(remaining / 60000);
  const ss = Math.floor((remaining % 60000) / 1000);

  function toggle(key: string) {
    const nextSel = q.questionType === "multi" ? (sel.includes(key) ? sel.filter((k) => k !== key) : [...sel, key]) : [key];
    save({ ...answers, [q.id]: nextSel });
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Exam simulation</h1>
        <div className={`rounded-lg px-3 py-1 font-mono text-lg tabular-nums ${remaining < 5 * 60000 ? "bg-bad-soft text-bad" : "bg-surface-2"}`} role="timer" aria-label="Time remaining">
          {mm}:{String(ss).padStart(2, "0")}
        </div>
      </div>
      <Progress index={index} total={qs.length} answered={answeredCount} />
      <article className="card p-4 sm:p-6">
        <QuestionHeader q={{ ...q, ref: `Question ${index + 1}`, categories: [] }} />
        <h2 className="text-lg font-medium leading-snug sm:text-xl">{q.prompt}</h2>
        <ul className="mt-5 space-y-2">
          {options.map((o) => (
            <li key={o.key}>
              <button
                type="button"
                role={q.questionType === "multi" ? "checkbox" : "radio"}
                aria-checked={sel.includes(o.key)}
                onClick={() => toggle(o.key)}
                className={`flex min-h-12 w-full items-center rounded-lg border px-3 py-2 text-left text-[15px] ${sel.includes(o.key) ? "border-accent bg-accent-soft" : "border-line hover:bg-surface-2"}`}
              >
                {o.text}
              </button>
            </li>
          ))}
        </ul>
        <div className="mt-5 flex justify-between gap-2">
          <button className="btn" disabled={index === 0} onClick={() => setIndex(index - 1)}>Previous</button>
          {index + 1 < qs.length ? (
            <button className="btn btn-primary" onClick={() => setIndex(index + 1)}>Next</button>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={submitExam}>Submit exam</button>
          )}
        </div>
      </article>
      <nav aria-label="Jump to question" className="mt-4 grid grid-cols-8 gap-1 sm:grid-cols-12">
        {qs.map((x, i) => (
          <button
            key={x.id}
            onClick={() => setIndex(i)}
            aria-current={i === index}
            aria-label={`Question ${i + 1}${(answers[x.id] ?? []).length ? ", answered" : ""}`}
            className={`h-9 rounded-md border text-xs ${i === index ? "border-accent ring-2 ring-accent/30" : "border-line"} ${(answers[x.id] ?? []).length ? "bg-accent-soft text-accent" : "bg-surface"}`}
          >
            {i + 1}
          </button>
        ))}
      </nav>
      {error && <p role="alert" className="mt-3 text-sm text-bad">{error} Your answers are kept; try submitting again.</p>}
      <div className="mt-4 text-center">
        <button className="btn" disabled={busy} onClick={() => confirm(`Submit now? ${qs.length - answeredCount} unanswered.`) && submitExam()}>
          Submit exam ({answeredCount}/{qs.length} answered)
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- summary

function Summary({ session, results }: { session: SessionData; results: Results }) {
  const router = useRouter();
  const correct = results.filter((r) => r.isCorrect).length;
  const total = session.mode === "exam" ? session.questions.length : results.length;
  const isExam = session.mode === "exam";
  const passMark = Math.ceil(total * (EXAM_FORMAT.passMark / EXAM_FORMAT.questions));
  const passed = correct >= passMark;
  const missed = results.filter((r) => !r.isCorrect);
  const [busy, setBusy] = useState(false);

  async function practiseMissed() {
    setBusy(true);
    const res = await api<{ id: string }>("/api/practice/sessions", { mode: "weak", count: Math.max(missed.length, 10) });
    router.push(`/practice/${res.id}`);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="card p-6 text-center">
        <p className="text-sm text-ink-2">{MODES[session.mode].label} complete</p>
        <p className="mt-2 text-4xl font-semibold tabular-nums">
          {correct}/{total}
        </p>
        <p className="mt-1 text-ink-2">{total ? Math.round((correct / total) * 100) : 0}% correct</p>
        {isExam && (
          <p className={`mt-3 inline-block rounded-full px-4 py-1 font-semibold ${passed ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`}>
            {passed ? "Pass" : "Not yet a pass"} — pass mark {passMark}/{total}
          </p>
        )}
        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {missed.length > 0 && (
            <button className="btn btn-primary" onClick={practiseMissed} disabled={busy}>
              Practise weak areas now
            </button>
          )}
          <Link href="/practice" className="btn">New session</Link>
          <Link href="/" className="btn">Dashboard</Link>
        </div>
      </div>
      <h2 className="mb-2 mt-6 font-semibold">Review answers</h2>
      <ul className="space-y-2">
        {results.map((r) => (
          <li key={r.questionId} className={`card border-l-4 p-4 ${r.isCorrect ? "border-l-good" : "border-l-bad"}`}>
            <div className="flex items-start justify-between gap-2">
              <Link href={`/questions/${r.questionId}`} className="font-medium hover:underline">{r.prompt}</Link>
              <span className={`shrink-0 text-xs font-semibold ${r.isCorrect ? "text-good" : "text-bad"}`}>{r.isCorrect ? "Correct" : "Incorrect"}</span>
            </div>
            <p className="mt-1 text-sm">
              <span className="text-ink-2">Answer: </span>
              {r.options.filter((o) => r.correctKeys.includes(o.key)).map((o) => o.text).join("; ")}
            </p>
            {!r.isCorrect && r.selectedKeys.length > 0 && (
              <p className="text-sm text-bad">You chose: {r.options.filter((o) => r.selectedKeys.includes(o.key)).map((o) => o.text).join("; ")}</p>
            )}
            {!r.isCorrect && r.explanation && <p className="mt-1 text-sm text-ink-2">{r.explanation}</p>}
            <p className="mt-1 text-xs text-muted">{r.ref}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
