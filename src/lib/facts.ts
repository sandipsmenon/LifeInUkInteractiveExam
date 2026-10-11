/**
 * Builds memory-training items from questions. Every item keeps the source question id, so exercises are
 * traceable, and is only produced when the question's correct answer clearly contains the fact.
 * Nothing is rewritten: labels are the original prompt text and answers are the original option text.
 */
import { jaccard, keywords } from "./text";

export interface FactSource {
  id: string;
  prompt: string;
  options: { key: string; text: string }[];
  correctKeys: string[];
  categories: string[];
  topics: string[];
  mockExamNumber: number | null;
  questionNumber: number | null;
}

export interface Fact {
  questionId: string;
  prompt: string;
  answer: string;
  ref: string;
}

export interface DatedFact extends Fact {
  sortValue: number; // years since year 0 (negative/approximate for "years ago")
  yearLabel: string;
}

export interface NumberFact extends Fact {
  numbers: string[]; // the figures in the answer, as written (e.g. "129", "84%", "£1000")
}

export function answerText(q: Pick<FactSource, "options" | "correctKeys">): string {
  return q.options.filter((o) => q.correctKeys.includes(o.key)).map((o) => o.text).join("; ");
}

export function refOf(q: Pick<FactSource, "mockExamNumber" | "questionNumber">): string {
  if (q.mockExamNumber == null) return "Unassigned";
  return `Mock ${q.mockExamNumber}${q.questionNumber ? ` · Q${q.questionNumber}` : ""}`;
}

const YEARS_AGO = /\b(\d{1,3}(?:,\d{3})*|\d+)\s+years ago\b/i;
const FULL_YEAR = /\b(1[0-9]{3}|20[0-9]{2})\b/;
const AD_YEAR = /\bAD\s?(\d{2,4})\b/;

export function extractYear(text: string, now = new Date()): { sortValue: number; label: string } | null {
  const ago = YEARS_AGO.exec(text);
  if (ago) {
    const n = Number(ago[1].replace(/,/g, ""));
    return { sortValue: now.getFullYear() - n, label: ago[0] };
  }
  const ad = AD_YEAR.exec(text);
  if (ad) return { sortValue: Number(ad[1]), label: ad[0] };
  const y = FULL_YEAR.exec(text);
  if (y) return { sortValue: Number(y[1]), label: text.trim() };
  return null;
}

function toFact(q: FactSource): Fact {
  return { questionId: q.id, prompt: q.prompt, answer: answerText(q), ref: refOf(q) };
}

/** Questions whose single correct answer is a year / date / "N years ago". */
export function datedFacts(qs: FactSource[]): DatedFact[] {
  const out: DatedFact[] = [];
  for (const q of qs) {
    if (q.correctKeys.length !== 1) continue;
    const answer = answerText(q);
    const year = extractYear(answer);
    if (!year) continue;
    out.push({ ...toFact(q), sortValue: year.sortValue, yearLabel: answer });
  }
  return out;
}

const NUMBER_TOKEN = /£?\d[\d,]*(?:\.\d+)?%?/g;

/** Questions whose single correct answer contains a figure that is not just a year. */
export function numberFacts(qs: FactSource[]): NumberFact[] {
  const out: NumberFact[] = [];
  for (const q of qs) {
    if (q.correctKeys.length !== 1) continue;
    const answer = answerText(q);
    const numbers = (answer.match(NUMBER_TOKEN) ?? []).filter((n) => !/^(1[0-9]{3}|20[0-9]{2})$/.test(n));
    if (!numbers.length) continue;
    if (FULL_YEAR.test(answer) && !q.categories.includes("numbers")) continue; // dates belong to the timeline
    out.push({ ...toFact(q), numbers });
  }
  return out;
}

/** Strips formatting so "£1,000", "1000" and "1000." compare equal. */
export function normaliseNumber(s: string): string {
  return s.replace(/[£,%\s]/g, "").replace(/\.0+$/, "").replace(/\.$/, "");
}

/** Checks a typed recall against every figure in the original answer. */
export function numberRecallCorrect(typed: string, fact: NumberFact): boolean {
  const typedNums = (typed.match(NUMBER_TOKEN) ?? []).map(normaliseNumber);
  const wanted = fact.numbers.map(normaliseNumber);
  return wanted.length > 0 && wanted.every((w) => typedNums.includes(w));
}

const NAME_LIKE = /^(?:(?:Sir|Dame|Lord|Lady|King|Queen|St|Saint|The)\s+)?[A-Z][\w'’.-]+(?:\s+(?:of|the|de|and)?\s*[A-Z][\w'’.-]+|\s+[IVX]+\b)+/;

/** Questions about a person whose single correct answer looks like a name or title. */
export function nameFacts(qs: FactSource[]): Fact[] {
  return qs
    .filter((q) => q.categories.includes("people") && q.correctKeys.length === 1)
    .filter((q) => NAME_LIKE.test(answerText(q)) || /^\s*who\b/i.test(q.prompt))
    .map(toFact);
}

export function allFacts(qs: FactSource[]): Fact[] {
  return qs.map(toFact);
}

export interface ComparisonGroup {
  reason: string;
  facts: Fact[];
}

/**
 * Pairs questions that are easy to mix up: same topic and same kind of answer (two dates, two figures,
 * two people), or very similar wording with different answers.
 */
export function confusableGroups(qs: FactSource[], limit = 30): ComparisonGroup[] {
  const kindOf = (q: FactSource) => {
    const a = answerText(q);
    if (extractYear(a)) return "date";
    if (/\d/.test(a)) return "number";
    if (q.categories.includes("people")) return "person";
    if (q.categories.includes("geography")) return "place";
    return null;
  };
  const kw = new Map(qs.map((q) => [q.id, keywords(q.prompt)]));
  const groups: { score: number; group: ComparisonGroup }[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < qs.length; i++) {
    for (let j = i + 1; j < qs.length; j++) {
      const a = qs[i];
      const b = qs[j];
      const ansA = answerText(a);
      const ansB = answerText(b);
      if (ansA.toLowerCase() === ansB.toLowerCase()) continue;
      const sim = jaccard(kw.get(a.id)!, kw.get(b.id)!);
      const sharedTopic = a.topics.find((t) => b.topics.includes(t));
      const kind = kindOf(a);
      let reason: string | null = null;
      let score = sim;
      if (sim >= 0.34) {
        reason = "Similar wording, different answers";
        score += 1;
      } else if (sharedTopic && kind && kind === kindOf(b)) {
        reason = `Both are ${kind === "person" ? "people" : kind + "s"} in “${sharedTopic}”`;
        score += 0.5;
      }
      if (!reason) continue;
      const key = [a.id, b.id].sort().join(":");
      if (seen.has(key)) continue;
      seen.add(key);
      groups.push({ score, group: { reason, facts: [toFact(a), toFact(b)] } });
    }
  }
  return groups
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((g) => g.group);
}

export function shuffle<T>(arr: T[], rand: () => number = Math.random): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
