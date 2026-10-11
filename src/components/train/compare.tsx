"use client";

import { useState } from "react";
import { shuffle, type ComparisonGroup } from "@/lib/facts";
import { NotEnough, SourceLink } from "./common";

export function CompareDrill({ groups }: { groups: ComparisonGroup[] }) {
  const [deck, setDeck] = useState(() => shuffle(groups));
  const [i, setI] = useState(0);
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const [score, setScore] = useState({ right: 0, done: 0 });
  if (!groups.length) return <NotEnough what="easily-confused facts" />;
  const g = deck[i % deck.length];
  const answers = shuffle(g.facts.map((f) => f.answer), () => ((i * 9301 + 49297) % 233280) / 233280);
  const allRight = g.facts.every((f) => picks[f.questionId] === f.answer);

  function check() {
    setChecked(true);
    setScore((s) => ({ right: s.right + (allRight ? 1 : 0), done: s.done + 1 }));
  }
  function next() {
    if ((i + 1) % deck.length === 0) setDeck(shuffle(groups));
    setI(i + 1);
    setPicks({});
    setChecked(false);
  }

  return (
    <div className="card p-4 sm:p-5">
      <div className="mb-2 flex justify-between text-xs text-ink-2">
        <span className="chip">{g.reason}</span>
        <span className="tabular-nums">{score.right}/{score.done} pairs right</span>
      </div>
      <p className="mb-3 text-sm text-ink-2">These are easy to confuse. Give each question its answer.</p>
      <ul className="space-y-3">
        {g.facts.map((f) => {
          const right = picks[f.questionId] === f.answer;
          return (
            <li key={f.questionId} className={`rounded-lg border p-3 ${checked ? (right ? "border-good bg-good-soft" : "border-bad bg-bad-soft") : "border-line"}`}>
              <p className="text-sm font-medium">{f.prompt}</p>
              <div className="mt-2 flex flex-wrap gap-2" role="radiogroup" aria-label={`Answer for: ${f.prompt}`}>
                {answers.map((a) => (
                  <button
                    key={a}
                    role="radio"
                    aria-checked={picks[f.questionId] === a}
                    disabled={checked}
                    onClick={() => setPicks({ ...picks, [f.questionId]: a })}
                    className={`btn btn-sm ${picks[f.questionId] === a ? "border-accent bg-accent-soft text-accent" : ""}`}
                  >
                    {a}
                  </button>
                ))}
              </div>
              {checked && !right && <p className="mt-1 text-sm">Answer: <strong>{f.answer}</strong></p>}
              <SourceLink questionId={f.questionId} label={f.ref} />
            </li>
          );
        })}
      </ul>
      <div className="mt-4">
        {!checked ? (
          <button className="btn btn-primary" onClick={check} disabled={Object.keys(picks).length < g.facts.length}>Check</button>
        ) : (
          <button className="btn btn-primary" onClick={next}>Next pair</button>
        )}
      </div>
    </div>
  );
}
