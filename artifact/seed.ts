// Produces the initial-dataset documents (questions + one batch) for the artifact's database.
// Usage: npx tsx artifact/seed.ts <out-dir>
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { categorise, deriveTopics } from "../src/lib/categorize";
import { markdownToBlocks } from "../src/lib/parser/markdown";
import { parseBlocks } from "../src/lib/parser/parse";
import { contentHash } from "./src/store";

const out = process.argv[2] ?? "artifact/seed-out";
const file = "LifeInUk-mock-1-3.md";
const bytes = readFileSync(path.join("data/initial", file));
const parsed = parseBlocks(markdownToBlocks(bytes.toString("utf8")));
const now = new Date().toISOString();
const batchId = "initial13";
mkdirSync(path.join(out, "questions"), { recursive: true });
let flagged = 0;
for (const r of parsed.questions) {
  const id = `init${String(r.sourcePosition).padStart(3, "0")}`;
  const tf = r.options.length === 2 && r.options.every((o) => /^(true|false)$/i.test(o.text.trim()));
  if (r.issues.length) flagged++;
  const doc = {
    seq: r.sourcePosition,
    pos: r.sourcePosition,
    prompt: r.prompt,
    type: tf ? "true_false" : r.correctKeys.length > 1 ? "multi" : "single",
    options: r.options.map(({ key, text }) => ({ key, text })),
    correctKeys: r.correctKeys,
    explanation: r.explanation,
    exam: null,
    qnum: null,
    sourceResult: r.sourceResult,
    original: {
      prompt: r.raw.prompt,
      options: r.raw.options.map((text, i) => ({ key: r.options[i].key, text })),
      correctKeys: r.correctKeys,
      explanation: r.raw.explanation.join("\n\n") || null,
      exam: null,
      qnum: null,
      rawResult: r.raw.result,
    },
    hash: contentHash(r.prompt, r.options),
    topics: deriveTopics(r),
    cats: categorise(r).map((slug) => ({ slug, source: "auto" })),
    notes: null,
    aid: null,
    important: r.promptHighlighted,
    confusing: false,
    flags: [],
    batchId,
    createdAt: now,
    editedAt: null,
  };
  writeFileSync(path.join(out, "questions", `${id}.json`), JSON.stringify(doc));
}
const batch = {
  filename: "LifeInUk-mock-1-3.docx (initial dataset)",
  fileHash: createHash("sha256").update(bytes).digest("hex"),
  label: "Initial dataset: mock tests 1–3",
  format: "markdown",
  stats: { imported: parsed.questions.length, skipped: 0, duplicates: 0, flagged, total: parsed.questions.length },
  interpretation: { ...parsed.interpretation, examAssignment: { mode: "none" } },
  createdAt: now,
};
writeFileSync(path.join(out, "batch.json"), JSON.stringify(batch));
console.log(`Wrote ${parsed.questions.length} questions and 1 batch to ${out}`);
