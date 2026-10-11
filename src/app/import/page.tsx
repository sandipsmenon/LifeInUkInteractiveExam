import { ImportWizard } from "@/components/import/wizard";
import { PageHeader } from "@/components/ui";
import { listBatches } from "@/lib/server/questions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Import" };

export default async function ImportPage() {
  const batches = await listBatches();
  return (
    <>
      <PageHeader
        title="Import questions"
        description="Upload the Word document (.docx) for your latest mock tests. Nothing is saved until you have reviewed the preview, and questions already in your bank are never duplicated."
      />
      <ImportWizard initialImported={batches.some((b) => b.filename === "LifeInUk-mock-1-8.md")} />
      <details className="card mt-6 p-4 text-sm text-ink-2">
        <summary className="cursor-pointer font-medium text-ink">How should my document be formatted?</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Each question on its own line, followed by the answer options as a <strong>bulleted list</strong>.</li>
          <li>The correct option(s) in <strong>bold</strong> or <mark>highlighted</mark> — the importer detects which, and asks you if it is unclear.</li>
          <li>Optionally a line saying <em>Correct</em> or <em>Incorrect</em> (your result in the mock test), then the explanation.</li>
          <li>Add a heading such as <em>Mock Test 4</em> before each test&apos;s questions so they are numbered per exam automatically.</li>
          <li>Old <code>.doc</code> files must be re-saved as <code>.docx</code>. Files are processed in memory and are not stored.</li>
        </ul>
      </details>
    </>
  );
}
