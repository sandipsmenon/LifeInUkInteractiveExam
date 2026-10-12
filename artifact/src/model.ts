import type { Confidence } from "../../src/lib/srs";

export const TOTAL_TESTS = 40;
export const PER_TEST = 24;
export const PASS_MARK = 18; // 75% of 24, as in the real Life in the UK test
export const TEST_MINUTES = 45;

export interface Option {
  key: string;
  text: string;
}
export interface Flag {
  id: string;
  reason: "confusing" | "possible_error" | "duplicate" | "other";
  note: string | null;
  at: string;
  resolvedAt: string | null;
}
export interface Original {
  prompt: string;
  options: Option[];
  correctKeys: string[];
  explanation: string | null;
  exam: number | null;
  qnum: number | null;
}
/**
 * A question, shared by everyone, in db `questions/<id>`.
 * `pos` is its position across all uploaded documents; it decides the test: test = ceil(pos / 24).
 */
export interface Question {
  id: string;
  seq: number;
  pos: number | null;
  prompt: string;
  type: "single" | "multi" | "true_false";
  options: Option[];
  correctKeys: string[];
  explanation: string | null;
  exam: number | null; // test number 1..40
  qnum: number | null; // question number inside the test 1..24
  original: Original | null;
  hash: string;
  topics: string[];
  cats: { slug: string; source: "auto" | "manual" }[];
  tips: string[]; // memory tips shown after a wrong answer
  notes: string | null;
  aid: string | null; // the owner's own memory aid, shown first
  important: boolean;
  confusing: boolean;
  flags: Flag[];
  batchId: string | null;
  createdAt: string;
  editedAt: string | null;
}
export interface Attempt {
  at: string;
  ok: boolean;
  sel: string[];
  conf: Confidence | null;
  mode: string;
  sid: string | null;
  self: boolean;
}
/** Each person's own answers to one question: db `data/users/<id>/profile/progress/<questionId>`. */
export interface Progress {
  attempts: Attempt[];
}
export interface Session {
  id: string;
  mode: Mode;
  test: number | null;
  label: string;
  config: Record<string, unknown>;
  qids: string[];
  startedAt: string;
  finishedAt: string | null;
  timeLimit: number | null;
}
export interface Batch {
  id: string;
  filename: string;
  fileHash: string;
  label: string | null;
  format: string;
  stats: { imported: number; skipped: number; duplicates: number; flagged: number; total: number };
  interpretation: Record<string, unknown>;
  createdAt: string;
}

export const CATEGORIES: { slug: string; name: string }[] = [
  { slug: "dates", name: "Years & dates" },
  { slug: "numbers", name: "Numbers & statistics" },
  { slug: "people", name: "People & names" },
  { slug: "monarchy", name: "Kings, queens & royalty" },
  { slug: "history", name: "History & events" },
  { slug: "government", name: "Government & politics" },
  { slug: "geography", name: "Geography & places" },
  { slug: "law", name: "Law, rights & everyday rules" },
  { slug: "culture", name: "Culture, arts & sport" },
  { slug: "religion", name: "Religion & festivals" },
  { slug: "science", name: "Science & inventions" },
  { slug: "values", name: "Values & society" },
  { slug: "uncategorised", name: "Uncategorised" },
];
export const CAT_NAME: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.slug, c.name]));

const has = (q: Question, slug: string) => q.cats.some((c) => c.slug === slug);
const answers = (q: Question) => q.options.filter((o) => q.correctKeys.includes(o.key)).map((o) => o.text).join(" ");

/** Question styles: how a question is asked or what kind of answer it wants. A question can have several. */
export const STYLES: { key: string; name: string; description: string; match: (q: Question) => boolean }[] = [
  {
    key: "truefalse",
    name: "True / False & Yes / No",
    description: "Two-option statements to judge.",
    match: (q) => q.options.length === 2 && q.options.every((o) => /^(true|false|yes|no)[.!]?$/i.test(o.text.trim())),
  },
  { key: "multi", name: "Choose two or more", description: "Questions with more than one right answer.", match: (q) => q.correctKeys.length > 1 },
  { key: "not", name: "“NOT” and “FALSE” questions", description: "Spot the one that does not belong.", match: (q) => /\bNOT\b|\bFALSE\b|\bnot\b.*\?$/.test(q.prompt) && q.options.length > 2 },
  { key: "numbers", name: "Numbers, ages & money", description: "Figures, percentages, ages, fines and populations.", match: (q) => has(q, "numbers") || (/\d/.test(answers(q)) && !has(q, "dates")) },
  { key: "dates", name: "Dates & years", description: "When things happened.", match: (q) => has(q, "dates") },
  { key: "names", name: "Names & people", description: "Who did what.", match: (q) => has(q, "people") },
  { key: "places", name: "Places", description: "Where things are.", match: (q) => has(q, "geography") },
];
export const STYLE_NAME: Record<string, string> = Object.fromEntries(STYLES.map((s) => [s.key, s.name]));

export const MODES = {
  test: { label: "Test" },
  retry: { label: "Retry mistakes" },
  style: { label: "Practice by style" },
  topic: { label: "Practice by topic" },
  mixed: { label: "Mixed practice" },
} as const;
export type Mode = keyof typeof MODES;

/** Short id: letters and digits only (valid as a db path segment and a URL anchor). */
export function newId(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => (b % 36).toString(36)).join("");
}

/** Fast synchronous 53-bit hash (cyrb53), run twice with different seeds. Used only for duplicate detection. */
function cyrb53(str: string, seed: number) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
}
export function textHash(s: string) {
  return cyrb53(s, 1) + cyrb53(s, 7);
}

/** Test placement for a question at document position `pos`. */
export function placement(pos: number) {
  return { exam: Math.floor((pos - 1) / PER_TEST) + 1, qnum: ((pos - 1) % PER_TEST) + 1 };
}
