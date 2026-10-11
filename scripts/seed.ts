// Imports the bundled initial dataset (data/initial) without the review screen.
// Prefer Import → "Load my initial dataset" in the app, which lets you review every record first.
// Safe to run repeatedly: questions already in the bank are skipped.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { commitImport, previewImport } from "../src/lib/server/importer";
import { getPool } from "../src/lib/server/db";

const FILE = "LifeInUk-mock-1-8.md";

async function main() {
  const bytes = new Uint8Array(await readFile(path.join(process.cwd(), "data", "initial", FILE)));
  const preview = await previewImport(FILE, bytes);
  console.log(`Parsed ${preview.summary.total} questions (${preview.summary.new} new, ${preview.summary.duplicates} already in the bank).`);
  for (const note of preview.interpretation.notes) console.log(`Note: ${note}`);
  const report = await commitImport({
    filename: FILE,
    format: preview.format,
    fileHash: preview.fileHash,
    label: "Mock tests 1–8",
    interpretation: preview.interpretation as unknown as Record<string, unknown>,
    allowSameFile: true,
    records: preview.records.map((r) => ({ ...r, approved: true, isImportant: r.promptHighlighted })),
  });
  console.log(`Imported ${report.imported}, duplicates skipped ${report.duplicates}, flagged ${report.flagged}.`);
  await getPool().end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
