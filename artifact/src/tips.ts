import type { Question } from "./model";
import { answerOf } from "./logic";

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Sample = any;

const RULES = `You write memory tips for people revising for the UK "Life in the UK" citizenship test.
For each question below, write ONE memory tip that makes the given correct answer easy to remember.
Good tips use a vivid image, a rhyme or wordplay, a link to something well known (for example "the NHS was founded in 1948, three years after the Second World War ended"), a contrast with the wrong options, or a light joke.
Rules:
- Treat the given answer as correct. Never contradict it and never add facts you are not sure of.
- Keep each tip under 35 words, in plain British English, friendly and a little playful.
- For a true/false question, say why the statement is true or false.
Reply with JSON only: an object whose keys are the question ids and whose values are arrays holding the one tip string.`;

/** Asks Claude (through the page's `sample` capability) for one memory tip per question. */
export async function generateTips(sample: Sample, qs: Question[]): Promise<Record<string, string[]>> {
  const items = qs.map((q) => ({
    id: q.id,
    question: q.prompt,
    options: q.options.map((o) => o.text),
    answer: answerOf(q),
    explanation: q.explanation ?? "",
  }));
  const result = await sample.json(`${RULES}\n\nQuestions:\n${JSON.stringify(items, null, 1)}`, { modelTier: "default" });
  const out: Record<string, string[]> = {};
  if (result && typeof result === "object") {
    for (const q of qs) {
      const v = (result as Record<string, unknown>)[q.id];
      const tips = (Array.isArray(v) ? v : typeof v === "string" ? [v] : [])
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
        .map((t) => t.trim().slice(0, 400))
        .slice(0, 3);
      if (tips.length) out[q.id] = tips;
    }
  }
  return out;
}

export function sampleErrorText(err: unknown) {
  const code = (err as { code?: string })?.code;
  if (code === "not_granted") return "Claude was not allowed to run on this page, so no tip could be made.";
  if (code === "rate_limited" || code === "usage_limit") return "Claude is busy or your usage limit was reached. Try again later.";
  if (code === "cancelled") return "Stopped.";
  return `A tip could not be made (${code ?? "error"}).`;
}
