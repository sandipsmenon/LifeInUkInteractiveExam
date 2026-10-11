"use client";

import { useState } from "react";
import { shuffle, type DatedFact } from "@/lib/facts";
import { NotEnough, SourceLink } from "./common";

const ROUND = 5;

function pickRound(facts: DatedFact[]): DatedFact[] {
  const seen = new Set<number>();
  const out: DatedFact[] = [];
  for (const f of shuffle(facts)) {
    if (seen.has(f.sortValue)) continue; // distinct dates only, so there is one right order
    seen.add(f.sortValue);
    out.push(f);
    if (out.length === ROUND) break;
  }
  return out;
}

export function Timeline({ facts }: { facts: DatedFact[] }) {
  const [tab, setTab] = useState<"order" | "match">("order");
  if (facts.length < 3) return <NotEnough what="dated facts" />;
  return (
    <>
      <div className="mb-4 flex gap-2" role="tablist">
        <button role="tab" aria-selected={tab === "order"} className={`btn btn-sm ${tab === "order" ? "border-accent bg-accent-soft text-accent" : ""}`} onClick={() => setTab("order")}>
          Arrange in order
        </button>
        <button role="tab" aria-selected={tab === "match"} className={`btn btn-sm ${tab === "match" ? "border-accent bg-accent-soft text-accent" : ""}`} onClick={() => setTab("match")}>
          Match event to date
        </button>
      </div>
      {tab === "order" ? <OrderGame facts={facts} /> : <MatchYears facts={facts} />}
    </>
  );
}

function OrderGame({ facts }: { facts: DatedFact[] }) {
  const [round, setRound] = useState(() => pickRound(facts));
  const [order, setOrder] = useState(() => shuffle(round));
  const [checked, setChecked] = useState(false);
  const correctOrder = [...round].sort((a, b) => a.sortValue - b.sortValue);
  const score = order.filter((f, i) => f.questionId === correctOrder[i].questionId).length;

  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = order.slice();
    [next[i], next[j]] = [next[j], next[i]];
    setOrder(next);
  }
  function newRound() {
    const r = pickRound(facts);
    setRound(r);
    setOrder(shuffle(r));
    setChecked(false);
  }

  return (
    <div className="card p-4 sm:p-5">
      <p className="mb-3 text-sm text-ink-2">Arrange from <strong>earliest</strong> (top) to <strong>latest</strong> (bottom). Dates are hidden until you check.</p>
      <ol className="space-y-2">
        {order.map((f, i) => {
          const right = checked && f.questionId === correctOrder[i].questionId;
          return (
            <li key={f.questionId} className={`flex items-center gap-2 rounded-lg border p-3 ${checked ? (right ? "border-good bg-good-soft" : "border-bad bg-bad-soft") : "border-line"}`}>
              <span className="w-5 text-center text-sm text-ink-2">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{f.prompt}</p>
                {checked && <p className="text-sm">{f.answer}</p>}
                <SourceLink questionId={f.questionId} label={f.ref} />
              </div>
              {!checked && (
                <div className="flex flex-col gap-1">
                  <button className="btn btn-sm" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move “${f.prompt}” up`}>↑</button>
                  <button className="btn btn-sm" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`Move “${f.prompt}” down`}>↓</button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {checked && (
        <div className="mt-4 rounded-lg bg-surface-2 p-3 text-sm" role="status">
          <p className="font-medium">{score}/{order.length} in the right position. Correct order:</p>
          <ol className="mt-1 list-decimal pl-5">
            {correctOrder.map((f) => <li key={f.questionId}><strong>{f.answer}</strong> — {f.prompt}</li>)}
          </ol>
        </div>
      )}
      <div className="mt-4 flex gap-2">
        {!checked ? <button className="btn btn-primary" onClick={() => setChecked(true)}>Check order</button> : <button className="btn btn-primary" onClick={newRound}>New round</button>}
      </div>
    </div>
  );
}

function MatchYears({ facts }: { facts: DatedFact[] }) {
  const [round, setRound] = useState(() => pickRound(facts));
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState(false);
  const [choices, setChoices] = useState(() => shuffle(round.map((f) => f.answer)));
  const score = round.filter((f) => picks[f.questionId] === f.answer).length;

  function newRound() {
    const r = pickRound(facts);
    setRound(r);
    setChoices(shuffle(r.map((f) => f.answer)));
    setPicks({});
    setChecked(false);
  }

  return (
    <div className="card p-4 sm:p-5">
      <p className="mb-3 text-sm text-ink-2">Choose the date that answers each question.</p>
      <ul className="space-y-3">
        {round.map((f) => {
          const right = picks[f.questionId] === f.answer;
          return (
            <li key={f.questionId} className={`rounded-lg border p-3 ${checked ? (right ? "border-good bg-good-soft" : "border-bad bg-bad-soft") : "border-line"}`}>
              <label htmlFor={`y-${f.questionId}`} className="text-sm font-medium">{f.prompt}</label>
              <select id={`y-${f.questionId}`} className="input mt-2" disabled={checked} value={picks[f.questionId] ?? ""} onChange={(e) => setPicks({ ...picks, [f.questionId]: e.target.value })}>
                <option value="">Choose…</option>
                {choices.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
              {checked && !right && <p className="mt-1 text-sm">Answer: <strong>{f.answer}</strong></p>}
              <SourceLink questionId={f.questionId} label={f.ref} />
            </li>
          );
        })}
      </ul>
      {checked && <p className="mt-3 font-medium" role="status">{score}/{round.length} correct</p>}
      <div className="mt-4">
        {!checked ? <button className="btn btn-primary" onClick={() => setChecked(true)} disabled={Object.keys(picks).length === 0}>Check</button> : <button className="btn btn-primary" onClick={newRound}>New round</button>}
      </div>
    </div>
  );
}
