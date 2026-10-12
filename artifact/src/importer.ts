import { categorise, deriveTopics } from "../../src/lib/categorize";
import { docxToBlocks } from "../../src/lib/parser/docx";
import { markdownToBlocks } from "../../src/lib/parser/markdown";
import { parseBlocks } from "../../src/lib/parser/parse";
import type { Interpretation, MarkerStyle, ParsedQuestion } from "../../src/lib/parser/types";
import { normalizeText } from "../../src/lib/text";
import { newId, placement, type Batch, type Question } from "./model";
import { ref } from "./logic";
import { contentHash, type Store } from "./store";

export const MAX_BYTES = 5 * 1024 * 1024;

export interface PreviewRecord extends ParsedQuestion {
  hash: string;
  /** Position across all documents; decides the test (24 per test). */
  pos: number | null;
  duplicateOf: { id: string; ref: string } | null;
  duplicateInFile: number | null;
  similarExisting: { id: string; ref: string } | null;
  approved: boolean;
  important: boolean;
}

export interface Preview {
  filename: string;
  format: "docx" | "markdown" | "text";
  fileHash: string;
  previousImport: Batch | null;
  interpretation: Interpretation;
  /** true when the document repeats the questions already in the bank at the same positions (a growing master file). */
  cumulative: boolean;
  firstNewPos: number;
  records: PreviewRecord[];
  ignored: string[];
}

async function sha256(bytes: Uint8Array) {
  const buf = await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function buildPreview(store: Store, file: File, markerStyle?: MarkerStyle): Promise<Preview> {
  if (file.size === 0) throw new Error("The file is empty.");
  if (file.size > MAX_BYTES) throw new Error("The file is larger than 5 MB.");
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  let format: Preview["format"];
  if (ext === "docx") {
    if (!isZip) throw new Error("This .docx file is not a valid Word document.");
    format = "docx";
  } else if (ext === "doc") throw new Error("Old .doc files are not supported. In Word choose File → Save As → .docx.");
  else if (ext === "md" || ext === "markdown") format = "markdown";
  else if (ext === "txt") format = "text";
  else throw new Error("Unsupported file type. Please upload a .docx file (or .md / .txt).");

  const blocks = format === "docx" ? await docxToBlocks(bytes) : markdownToBlocks(new TextDecoder().decode(bytes));
  const parsed = parseBlocks(blocks, { markerStyle });
  if (!parsed.questions.length) {
    throw new Error("No questions were found. Each question should be followed by its options as a bulleted list, with the correct option(s) in bold or highlighted.");
  }
  const fileHash = await sha256(bytes);
  const existing = store.allQuestions();
  const byHash = new Map(existing.map((q) => [q.hash, q]));
  const byPrompt = new Map(existing.map((q) => [normalizeText(q.prompt), q]));

  // A growing master document repeats existing questions at the same positions; a "new questions only"
  // document does not. In the first case positions come from the document, otherwise they continue the bank.
  const dups = parsed.questions.map((pq) => byHash.get(contentHash(pq.prompt, pq.options))).filter(Boolean) as Question[];
  const samePlace = parsed.questions.filter((pq) => byHash.get(contentHash(pq.prompt, pq.options))?.pos === pq.sourcePosition).length;
  const cumulative = dups.length > 0 && samePlace >= dups.length * 0.9;
  const firstNewPos = store.maxPos() + 1;

  const firstInFile = new Map<string, number>();
  let nextPos = firstNewPos;
  const records = parsed.questions.map((pq) => {
    const hash = contentHash(pq.prompt, pq.options);
    const dup = byHash.get(hash);
    const inFile = firstInFile.get(hash) ?? null;
    if (inFile === null) firstInFile.set(hash, pq.sourcePosition);
    const similar = !dup ? byPrompt.get(normalizeText(pq.prompt)) : undefined;
    const isNew = !dup && inFile === null;
    const pos = dup ? dup.pos : isNew ? (cumulative ? pq.sourcePosition : nextPos++) : null;
    const place = pos ? placement(pos) : { exam: null, qnum: null };
    return {
      ...pq,
      sourceResult: null, // results written in the document are deliberately not used
      hash,
      pos,
      mockExamNumber: pq.mockExamNumber ?? place.exam,
      questionNumber: pq.mockExamNumber ? pq.questionNumber : place.qnum,
      duplicateOf: dup ? { id: dup.id, ref: ref(dup) } : null,
      duplicateInFile: inFile,
      similarExisting: similar ? { id: similar.id, ref: ref(similar) } : null,
      approved: isNew && !pq.issues.some((i) => i.severity === "error"),
      important: pq.promptHighlighted,
    };
  });
  return {
    filename: file.name,
    format,
    fileHash,
    previousImport: [...store.batches.values()].find((b) => b.fileHash === fileHash) ?? null,
    interpretation: parsed.interpretation,
    cumulative,
    firstNewPos,
    records,
    ignored: parsed.ignoredBlocks,
  };
}

export interface Report {
  batchId: string;
  imported: number;
  skipped: number;
  duplicates: number;
  flagged: number;
  newIds: string[];
}

export async function commitImport(store: Store, p: Preview, label: string, extra: Record<string, unknown>, onProgress?: (n: number) => void): Promise<Report> {
  for (const r of p.records) {
    if (!r.approved) continue;
    const keys = new Set(r.options.map((o) => o.key));
    if (!r.correctKeys.length || !r.correctKeys.every((k) => keys.has(k)) || r.correctKeys.length >= r.options.length) {
      throw new Error(`Record #${r.sourcePosition} needs exactly the correct option(s) ticked before it can be imported.`);
    }
    if (r.prompt.trim().length < 3) throw new Error(`Record #${r.sourcePosition} has no question text.`);
  }
  const batchId = newId();
  const now = new Date().toISOString();
  const seen = new Set(store.allQuestions().map((q) => q.hash));
  let fallbackPos = store.maxPos() + 1;
  const toWrite: Question[] = [];
  let duplicates = 0;
  let flagged = 0;
  for (const r of p.records) {
    if (!r.approved) continue;
    const hash = contentHash(r.prompt, r.options);
    if (seen.has(hash)) {
      duplicates++;
      continue;
    }
    seen.add(hash);
    const pos = r.pos ?? fallbackPos++;
    const tf = r.options.length === 2 && r.options.every((o) => /^(true|false)$/i.test(o.text.trim().replace(/[.!]$/, "")));
    const q: Question = {
      id: newId(),
      seq: pos,
      pos,
      prompt: r.prompt.trim(),
      type: tf ? "true_false" : r.correctKeys.length > 1 ? "multi" : "single",
      options: r.options.map(({ key, text }) => ({ key, text: text.trim() })),
      correctKeys: [...r.correctKeys].sort(),
      explanation: r.explanation?.trim() || null,
      exam: r.mockExamNumber,
      qnum: r.questionNumber,
      original: {
        prompt: r.raw.prompt,
        options: r.raw.options.map((text, i) => ({ key: r.options[i]?.key ?? String(i + 1), text })),
        correctKeys: r.correctKeys,
        explanation: r.raw.explanation.join("\n\n") || null,
        exam: r.mockExamNumber,
        qnum: r.questionNumber,
      },
      hash,
      topics: deriveTopics(r),
      cats: categorise(r).map((slug) => ({ slug, source: "auto" as const })),
      tips: [],
      notes: null,
      aid: null,
      important: r.important,
      confusing: false,
      flags: r.issues.length
        ? [{ id: newId(), reason: "possible_error", note: `Import check: ${r.issues.map((i) => i.message).join(" ")}`, at: now, resolvedAt: null }]
        : [],
      batchId,
      createdAt: now,
      editedAt: null,
    };
    if (r.issues.length) flagged++;
    toWrite.push(q);
  }
  const skipped = p.records.filter((r) => !r.approved).length;
  const stats = { imported: toWrite.length, skipped, duplicates, flagged, total: p.records.length };
  await store.putBatch({
    id: batchId,
    filename: p.filename,
    fileHash: p.fileHash,
    label: label || null,
    format: p.format,
    stats,
    interpretation: { ...p.interpretation, cumulative: p.cumulative, ...extra } as unknown as Record<string, unknown>,
    createdAt: now,
  });
  await store.putQuestions(toWrite, onProgress);
  return { batchId, ...stats, newIds: toWrite.map((q) => q.id) };
}
