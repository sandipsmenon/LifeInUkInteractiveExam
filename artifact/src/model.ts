import type { Confidence } from "../../src/lib/srs";

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
  rawResult?: string | null;
}
/** A question as stored in db `questions/<id>`. The `original` snapshot is never modified. */
export interface Question {
  id: string;
  seq: number; // global order of arrival; also the position in its source document
  pos: number | null; // position inside its source document
  prompt: string;
  type: "single" | "multi" | "true_false";
  options: Option[];
  correctKeys: string[];
  explanation: string | null;
  exam: number | null;
  qnum: number | null;
  sourceResult: "correct" | "incorrect" | null;
  original: Original | null;
  hash: string;
  topics: string[];
  cats: { slug: string; source: "auto" | "manual" }[];
  notes: string | null;
  aid: string | null;
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
/** db `progress/<questionId>`: the attempt log for one question (the schedule is replayed from it). */
export interface Progress {
  attempts: Attempt[];
}
export interface Session {
  id: string;
  mode: Mode;
  config: Record<string, unknown>;
  qids: string[];
  reasons: Record<string, string[]>;
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
  { slug: "law", name: "Law, rights & citizenship" },
  { slug: "culture", name: "Culture, arts & sport" },
  { slug: "religion", name: "Religion & festivals" },
  { slug: "science", name: "Science & inventions" },
  { slug: "values", name: "Values & society" },
  { slug: "uncategorised", name: "Uncategorised" },
];
export const CAT_NAME: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.slug, c.name]));

export const MODES = {
  weak: { label: "Weak areas", description: "Questions you get wrong, forget, or have not mastered — each shows why it was picked." },
  revision: { label: "Revision (due)", description: "Spaced-repetition reviews that are due now." },
  quick: { label: "Quick practice", description: "Random questions from your whole bank." },
  category: { label: "Category practice", description: "Focus on one category, such as dates or people." },
  mixed: { label: "Mixed practice", description: "Interleave questions from several categories." },
  mock: { label: "Mock exam practice", description: "Replay one mock test's questions in order." },
  rapid: { label: "Rapid recall", description: "See the question, recall in your head, reveal and mark yourself." },
  exam: { label: "Exam simulation", description: "24 questions, 45 minutes, 18 to pass. Marked when you submit." },
} as const;
export type Mode = keyof typeof MODES;
export const EXAM = { questions: 24, minutes: 45, passMark: 18 };

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
