import "server-only";
import { z } from "zod";
import { deriveTopics } from "@/lib/categorize";
import { docxToBlocks, DocxError } from "@/lib/parser/docx";
import { markdownToBlocks } from "@/lib/parser/markdown";
import { parseBlocks } from "@/lib/parser/parse";
import type { Interpretation, MarkerStyle, ParsedQuestion } from "@/lib/parser/types";
import { contentHash, promptKey, sha256 } from "@/lib/text";
import type { OriginalSnapshot } from "@/lib/types";
import { query, tx } from "./db";
import { applyAutoCategories, ensureMockExam, questionTypeOf } from "./questions";

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export class ImportError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export type SourceFormat = "docx" | "markdown" | "text";

export function detectFormat(filename: string, bytes: Uint8Array): SourceFormat {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (ext === "docx") {
    if (!isZip) throw new ImportError("This .docx file is not a valid Word document.");
    return "docx";
  }
  if (ext === "doc") throw new ImportError("Old .doc files are not supported. In Word choose File → Save As → .docx.");
  if (isZip) throw new ImportError("Unsupported archive. Please upload a .docx, .md or .txt file.");
  if (ext === "md" || ext === "markdown") return "markdown";
  if (ext === "txt") return "text";
  throw new ImportError("Unsupported file type. Please upload a .docx file (or .md / .txt).");
}

export interface PreviewRecord extends ParsedQuestion {
  contentHash: string;
  duplicateOf: { id: string; ref: string } | null;
  duplicateInFile: number | null; // source position of the first copy in this file
  similarExisting: { id: string; ref: string; prompt: string } | null; // same wording, different options
  suggestedTopics: string[];
}

export interface ImportPreview {
  filename: string;
  format: SourceFormat;
  fileHash: string;
  previousImport: { id: string; createdAt: string; label: string | null } | null;
  interpretation: Interpretation;
  records: PreviewRecord[];
  ignoredBlocks: string[];
  summary: { total: number; new: number; duplicates: number; withErrors: number; withWarnings: number };
}

function ref(n: number | null, q: number | null) {
  return n == null ? "Unassigned" : `Mock ${n}${q ? ` · Q${q}` : ""}`;
}

export async function parseUpload(filename: string, bytes: Uint8Array, markerStyle?: MarkerStyle) {
  if (bytes.byteLength === 0) throw new ImportError("The file is empty.");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) throw new ImportError("The file is larger than 5 MB.", 413);
  const format = detectFormat(filename, bytes);
  let blocks;
  try {
    blocks = format === "docx" ? await docxToBlocks(bytes) : markdownToBlocks(new TextDecoder("utf-8").decode(bytes));
  } catch (err) {
    if (err instanceof DocxError) throw new ImportError(err.message);
    throw err;
  }
  const parsed = parseBlocks(blocks, { markerStyle });
  if (parsed.questions.length === 0) {
    throw new ImportError(
      "No questions were found. The importer expects each question followed by its answer options as a bulleted list, with the correct option(s) in bold or highlighted.",
    );
  }
  return { format, parsed, fileHash: sha256(bytes) };
}

export async function previewImport(filename: string, bytes: Uint8Array, markerStyle?: MarkerStyle): Promise<ImportPreview> {
  const { format, parsed, fileHash } = await parseUpload(filename, bytes, markerStyle);
  const hashes = parsed.questions.map((q) => contentHash(q.prompt, q.options));
  const keys = parsed.questions.map((q) => promptKey(q.prompt));

  const [existing, prev] = await Promise.all([
    query<{ id: string; content_hash: string; prompt: string; mock_exam_number: number | null; question_number: number | null }>(
      "SELECT id, content_hash, prompt, mock_exam_number, question_number FROM questions",
    ),
    query("SELECT id, created_at, label FROM import_batches WHERE file_hash = $1 ORDER BY created_at LIMIT 1", [fileHash]),
  ]);
  const byHash = new Map(existing.map((e) => [e.content_hash, e]));
  const byPrompt = new Map(existing.map((e) => [promptKey(e.prompt), e]));
  const firstInFile = new Map<string, number>();

  const records: PreviewRecord[] = parsed.questions.map((q, i) => {
    const dup = byHash.get(hashes[i]);
    const inFile = firstInFile.get(hashes[i]) ?? null;
    if (inFile === null) firstInFile.set(hashes[i], q.sourcePosition);
    const similar = !dup ? byPrompt.get(keys[i]) : undefined;
    return {
      ...q,
      contentHash: hashes[i],
      duplicateOf: dup ? { id: dup.id, ref: ref(dup.mock_exam_number, dup.question_number) } : null,
      duplicateInFile: inFile,
      similarExisting: similar
        ? { id: similar.id, ref: ref(similar.mock_exam_number, similar.question_number), prompt: similar.prompt }
        : null,
      suggestedTopics: deriveTopics(q),
    };
  });

  return {
    filename,
    format,
    fileHash,
    previousImport: prev[0]
      ? { id: prev[0].id, createdAt: new Date(prev[0].created_at).toISOString(), label: prev[0].label }
      : null,
    interpretation: parsed.interpretation,
    records,
    ignoredBlocks: parsed.ignoredBlocks,
    summary: {
      total: records.length,
      new: records.filter((r) => !r.duplicateOf && r.duplicateInFile === null).length,
      duplicates: records.filter((r) => r.duplicateOf || r.duplicateInFile !== null).length,
      withErrors: records.filter((r) => r.issues.some((i) => i.severity === "error")).length,
      withWarnings: records.filter((r) => r.issues.some((i) => i.severity === "warning")).length,
    },
  };
}

const commitRecordSchema = z.object({
  approved: z.boolean(),
  sourcePosition: z.number().int().min(1),
  mockExamNumber: z.number().int().min(1).max(200).nullable(),
  questionNumber: z.number().int().min(1).max(1000).nullable(),
  prompt: z.string().trim().min(3).max(1000),
  options: z.array(z.object({ key: z.string().min(1).max(3), text: z.string().trim().min(1).max(500) })).min(2).max(10),
  correctKeys: z.array(z.string()).min(1),
  explanation: z.string().max(5000).nullable(),
  sourceResult: z.enum(["correct", "incorrect"]).nullable(),
  isImportant: z.boolean().default(false),
  issues: z.array(z.object({ code: z.string(), message: z.string(), severity: z.enum(["error", "warning"]) })).default([]),
  raw: z
    .object({
      prompt: z.string(),
      options: z.array(z.string()),
      result: z.string().nullable(),
      explanation: z.array(z.string()),
    })
    .optional(),
});

export const commitSchema = z.object({
  filename: z.string().min(1).max(255),
  format: z.enum(["docx", "markdown", "text"]),
  fileHash: z.string().regex(/^[a-f0-9]{64}$/),
  label: z.string().trim().max(200).optional(),
  interpretation: z.record(z.string(), z.unknown()).default({}),
  allowSameFile: z.boolean().default(false),
  records: z.array(commitRecordSchema).min(1).max(2000),
});
export type CommitInput = z.infer<typeof commitSchema>;

export interface ImportReport {
  batchId: string;
  imported: number;
  skipped: number; // rejected in the preview
  duplicates: number; // already in the bank (or repeated within the file)
  flagged: number; // imported with open warnings, a flag is created so they can be reviewed later
  invalid: { sourcePosition: number; message: string }[];
}

export async function commitImport(input: CommitInput): Promise<ImportReport> {
  // Validate each approved record's answer keys before touching the database.
  const invalid: ImportReport["invalid"] = [];
  for (const r of input.records) {
    if (!r.approved) continue;
    const keys = new Set(r.options.map((o) => o.key));
    if (keys.size !== r.options.length) invalid.push({ sourcePosition: r.sourcePosition, message: "Duplicate option keys." });
    else if (!r.correctKeys.every((k) => keys.has(k)))
      invalid.push({ sourcePosition: r.sourcePosition, message: "A correct answer is not one of the options." });
    else if (r.correctKeys.length >= r.options.length)
      invalid.push({ sourcePosition: r.sourcePosition, message: "Every option is marked correct." });
  }
  if (invalid.length) {
    throw new ImportError(
      `Some approved records are invalid: ${invalid.map((i) => `#${i.sourcePosition} ${i.message}`).join("; ")}`,
    );
  }

  return tx(async (c) => {
    // Serialise imports so two simultaneous uploads cannot both insert the same question.
    await c.query("SELECT pg_advisory_xact_lock(74260002)");
    const prev = await c.query("SELECT id FROM import_batches WHERE file_hash = $1 LIMIT 1", [input.fileHash]);
    if (prev.rows[0] && !input.allowSameFile) {
      throw new ImportError("This exact file has already been imported. Confirm to import it again (duplicates are still skipped).", 409);
    }
    const batch = await c.query(
      `INSERT INTO import_batches (filename, file_hash, source_format, label, interpretation)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [input.filename, input.fileHash, input.format, input.label || null, JSON.stringify(input.interpretation)],
    );
    const batchId = batch.rows[0].id as string;
    let imported = 0;
    let duplicates = 0;
    let flagged = 0;
    const skipped = input.records.filter((r) => !r.approved).length;

    for (const r of input.records) {
      if (!r.approved) continue;
      if (r.mockExamNumber) await ensureMockExam(c, r.mockExamNumber);
      const hash = contentHash(r.prompt, r.options);
      const original: OriginalSnapshot = {
        prompt: r.raw?.prompt ?? r.prompt,
        options: r.raw ? r.raw.options.map((text, i) => ({ key: r.options[i]?.key ?? String(i + 1), text })) : r.options,
        correctKeys: r.correctKeys,
        explanation: r.explanation,
        mockExamNumber: r.mockExamNumber,
        questionNumber: r.questionNumber,
        raw: r.raw,
      };
      const res = await c.query(
        `INSERT INTO questions (batch_id, mock_exam_number, question_number, source_position, prompt, question_type,
           options, correct_keys, explanation, source_result, original, content_hash, topics, is_important)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (content_hash) DO NOTHING RETURNING id`,
        [
          batchId,
          r.mockExamNumber,
          r.questionNumber,
          r.sourcePosition,
          r.prompt,
          questionTypeOf(r.options, r.correctKeys),
          JSON.stringify(r.options),
          r.correctKeys,
          r.explanation,
          r.sourceResult,
          JSON.stringify(original),
          hash,
          deriveTopics(r),
          r.isImportant,
        ],
      );
      const id = res.rows[0]?.id as string | undefined;
      if (!id) {
        duplicates++;
        continue;
      }
      imported++;
      await applyAutoCategories(c, id, r);
      await c.query("INSERT INTO review_states (question_id) VALUES ($1) ON CONFLICT DO NOTHING", [id]);
      if (r.issues.length) {
        flagged++;
        await c.query("INSERT INTO question_flags (question_id, reason, note) VALUES ($1, 'possible_error', $2)", [
          id,
          `Import check: ${r.issues.map((i) => i.message).join(" ")}`,
        ]);
      }
    }
    const stats = { imported, skipped, duplicates, flagged, total: input.records.length };
    await c.query("UPDATE import_batches SET stats = $2 WHERE id = $1", [batchId, JSON.stringify(stats)]);
    return { batchId, imported, skipped, duplicates, flagged, invalid: [] };
  });
}

/** Removes a batch and every question it created (with their history). */
export async function deleteBatch(batchId: string, withQuestions: boolean) {
  await tx(async (c) => {
    if (withQuestions) await c.query("DELETE FROM questions WHERE batch_id = $1", [batchId]);
    await c.query("DELETE FROM import_batches WHERE id = $1", [batchId]);
  });
}
