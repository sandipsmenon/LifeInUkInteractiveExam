"use client";

import { useState } from "react";
import { shuffle, type Fact } from "@/lib/facts";
import { NotEnough, SourceLink } from "./common";

const ROUND = 5;

function pick(facts: Fact[]) {
  // Avoid two items with the same answer in one round, so each match is unambiguous.
  const seen = new Set<string>();
  return shuffle(facts).filter((f) => {
    const k = f.answer.toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, ROUND);
}

export function MatchingGame({ facts, leftLabel, rightLabel }: { facts: Fact[]; leftLabel: string; rightLabel: string }) {
  const [round, setRound] = useState(() => pick(facts));
  const [answers, setAnswers] = useState(() => shuffle(round.map((f) => f.questionId)));
  const [active, setActive] = useState<string | null>(null);
  const [pairs, setPairs] = useState<Record<string, string>>({}); // left questionId -> right questionId
  const [checked, setChecked] = useState(false);
  if (facts.length < 3) return <NotEnough what="facts" />;

  const byId = new Map(round.map((f) => [f.questionId, f]));
  const used = new Set(Object.values(pairs));
  const score = round.filter((f) => pairs[f.questionId] === f.questionId).length;

  function chooseRight(rid: string) {
    if (!active || checked) return;
    const next = Object.fromEntries(Object.entries(pairs).filter(([, v]) => v !== rid));
    next[active] = rid;
    setPairs(next);
    setActive(null);
  }
  function newRound() {
    const r = pick(facts);
    setRound(r);
    setAnswers(shuffle(r.map((f) => f.questionId)));
    setPairs({});
    setChecked(false);
    setActive(null);
  }

  return (
    <div className="card p-4 sm:p-5">
      <p className="mb-3 text-sm text-ink-2">Select a {leftLabel.toLowerCase()}, then the {rightLabel.toLowerCase()} that goes with it.</p>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <h2 className="label">{leftLabel}</h2>
          <ul className="space-y-2">
            {round.map((f, i) => {
              const paired = pairs[f.questionId];
              const right = checked && paired === f.questionId;
              return (
                <li key={f.questionId}>
                  <button
                    onClick={() => !checked && setActive(active === f.questionId ? null : f.questionId)}
                    aria-pressed={active === f.questionId}
                    className={`w-full rounded-lg border p-3 text-left text-sm ${active === f.questionId ? "border-accent bg-accent-soft" : checked ? (right ? "border-good bg-good-soft" : "border-bad bg-bad-soft") : "border-line hover:bg-surface-2"}`}
                  >
                    <span className="mr-2 font-semibold text-ink-2">{i + 1}.</span>
                    {f.prompt}
                    {paired && (
                      <span className="mt-1 block text-xs text-accent">→ {byId.get(paired)?.answer}</span>
                    )}
                    {checked && !right && <span className="mt-1 block text-xs text-good">Answer: {f.answer}</span>}
                  </button>
                  {checked && <SourceLink questionId={f.questionId} label={f.ref} />}
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <h2 className="label">{rightLabel}</h2>
          <ul className="space-y-2">
            {answers.map((id) => (
              <li key={id}>
                <button
                  onClick={() => chooseRight(id)}
                  disabled={!active || checked}
                  className={`w-full rounded-lg border p-3 text-left text-sm ${used.has(id) ? "border-line bg-surface-2 text-ink-2" : "border-line"} ${active ? "hover:border-accent" : ""}`}
                >
                  {byId.get(id)?.answer}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {checked && <p className="mt-4 font-medium" role="status">{score}/{round.length} matched correctly</p>}
      <div className="mt-4 flex gap-2">
        {!checked ? (
          <button className="btn btn-primary" onClick={() => setChecked(true)} disabled={Object.keys(pairs).length === 0}>Check matches</button>
        ) : (
          <button className="btn btn-primary" onClick={newRound}>New round</button>
        )}
        {!checked && Object.keys(pairs).length > 0 && <button className="btn" onClick={() => setPairs({})}>Reset</button>}
      </div>
    </div>
  );
}
