"use client";

import { useRef, useState } from "react";
import { numberRecallCorrect, shuffle, type NumberFact } from "@/lib/facts";
import { NotEnough, SourceLink, recordRecall } from "./common";

export function NumberDrill({ facts }: { facts: NumberFact[] }) {
  const [deck, setDeck] = useState(() => shuffle(facts));
  const [i, setI] = useState(0);
  const [typed, setTyped] = useState("");
  const [result, setResult] = useState<boolean | null>(null);
  const [score, setScore] = useState({ right: 0, done: 0 });
  const input = useRef<HTMLInputElement>(null);
  if (!facts.length) return <NotEnough what="numerical facts" />;
  const f = deck[i % deck.length];

  function check(e: React.FormEvent) {
    e.preventDefault();
    if (result !== null || !typed.trim()) return;
    const ok = numberRecallCorrect(typed, f);
    setResult(ok);
    setScore((s) => ({ right: s.right + (ok ? 1 : 0), done: s.done + 1 }));
    recordRecall(f.questionId, "number_drill", ok);
  }
  function next() {
    if ((i + 1) % deck.length === 0) setDeck(shuffle(facts));
    setI(i + 1);
    setTyped("");
    setResult(null);
    setTimeout(() => input.current?.focus(), 0);
  }

  return (
    <div className="card p-4 sm:p-6">
      <div className="mb-2 flex justify-between text-xs text-ink-2">
        <span>Card {(i % deck.length) + 1} of {deck.length}</span>
        <span className="tabular-nums">{score.right}/{score.done} correct</span>
      </div>
      <h2 className="text-lg font-medium">{f.prompt}</h2>
      <form onSubmit={check} className="mt-4 flex gap-2">
        <label htmlFor="num" className="sr-only">Your answer</label>
        <input ref={input} id="num" inputMode="decimal" autoComplete="off" className="input text-lg" placeholder="Type the number" value={typed} onChange={(e) => setTyped(e.target.value)} disabled={result !== null} autoFocus />
        {result === null && <button className="btn btn-primary">Check</button>}
      </form>
      {result !== null && (
        <div className="mt-4 space-y-2" role="status">
          <p className={`rounded-lg px-3 py-2 font-medium ${result ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`}>
            {result ? "Correct" : "Not quite"} — the answer is <strong>{f.answer}</strong>
          </p>
          <div className="flex items-center justify-between">
            <SourceLink questionId={f.questionId} label={f.ref} />
            <button className="btn btn-primary" onClick={next} autoFocus>Next</button>
          </div>
          <p className="text-xs text-muted">Saved to your progress for this question.</p>
        </div>
      )}
    </div>
  );
}
