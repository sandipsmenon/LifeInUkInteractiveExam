"use client";

import { useMemo, useState } from "react";
import { shuffle } from "@/lib/facts";
import { SourceLink, recordRecall } from "./common";

interface Card {
  questionId: string;
  prompt: string;
  answer: string;
  ref: string;
  categories: string[];
}

const GRADES = [
  { label: "Again", knew: false, confidence: null, style: "border-bad text-bad" },
  { label: "Hard", knew: true, confidence: 1, style: "" },
  { label: "Good", knew: true, confidence: 2, style: "" },
  { label: "Easy", knew: true, confidence: 3, style: "border-good text-good" },
] as const;

export function Flashcards({ cards, categories }: { cards: Card[]; categories: { slug: string; name: string }[] }) {
  const [category, setCategory] = useState("");
  const pool = useMemo(() => (category ? cards.filter((c) => c.categories.includes(category)) : cards), [cards, category]);
  const [deck, setDeck] = useState(() => shuffle(pool));
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [tally, setTally] = useState({ again: 0, known: 0 });

  function changeCategory(slug: string) {
    setCategory(slug);
    setDeck(shuffle(slug ? cards.filter((c) => c.categories.includes(slug)) : cards));
    setI(0);
    setFlipped(false);
  }

  if (!deck.length) return <p className="card p-6 text-sm text-ink-2">No cards in this category.</p>;
  const done = i >= deck.length;
  const card = deck[Math.min(i, deck.length - 1)];

  function grade(g: (typeof GRADES)[number]) {
    recordRecall(card.questionId, "flashcards", g.knew, g.confidence);
    setTally((t) => (g.knew ? { ...t, known: t.known + 1 } : { ...t, again: t.again + 1 }));
    // "Again" cards come back at the end of this deck.
    if (!g.knew) setDeck((d) => [...d, card]);
    setI(i + 1);
    setFlipped(false);
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label htmlFor="fc-cat" className="text-sm text-ink-2">Deck</label>
        <select id="fc-cat" className="input w-auto" value={category} onChange={(e) => changeCategory(e.target.value)}>
          <option value="">All questions ({cards.length})</option>
          {categories.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
        </select>
        <span className="ml-auto text-xs tabular-nums text-ink-2">
          {Math.min(i, deck.length)}/{deck.length} · {tally.known} known · {tally.again} again
        </span>
      </div>
      {done ? (
        <div className="card p-6 text-center">
          <p className="font-medium">Deck finished</p>
          <p className="mt-1 text-sm text-ink-2">{tally.known} known, {tally.again} to repeat. Ratings were saved to your revision schedule.</p>
          <button className="btn btn-primary mt-4" onClick={() => changeCategory(category)}>Shuffle and restart</button>
        </div>
      ) : (
        <div className="card p-4 sm:p-6">
          <button
            className="flex min-h-48 w-full flex-col items-center justify-center rounded-lg border border-dashed border-line p-6 text-center"
            onClick={() => setFlipped((f) => !f)}
            aria-label={flipped ? "Show question" : "Show answer"}
          >
            <span className="text-xs uppercase tracking-wide text-muted">{flipped ? "Answer" : "Question"}</span>
            <span className={`mt-2 ${flipped ? "text-2xl font-semibold" : "text-lg font-medium"}`}>{flipped ? card.answer : card.prompt}</span>
            {flipped && <span className="mt-3 text-sm text-ink-2">{card.prompt}</span>}
            {!flipped && <span className="mt-4 text-xs text-muted">Tap to flip</span>}
          </button>
          <div className="mt-3 flex items-center justify-between">
            <SourceLink questionId={card.questionId} label={card.ref} />
          </div>
          {flipped && (
            <div className="mt-4 grid grid-cols-4 gap-2" aria-label="How well did you recall it?">
              {GRADES.map((g) => (
                <button key={g.label} className={`btn ${g.style}`} onClick={() => grade(g)}>{g.label}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
