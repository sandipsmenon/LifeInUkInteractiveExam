import { BatchList, RestoreForm } from "@/components/data/data-tools";
import { PageHeader, Section } from "@/components/ui";
import { listBatches } from "@/lib/server/questions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Backup & data" };

export default async function DataPage() {
  const batches = await listBatches();
  return (
    <>
      <PageHeader title="Backup & data" description="Your data lives in the database and syncs across devices. Download a backup regularly, especially before large imports." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Export">
          <p className="text-sm text-ink-2">The full backup contains every question, the original imported text, categories, practice history, revision schedules and flags.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="/api/export" className="btn btn-primary">Download full backup (.json)</a>
            <a href="/api/export?format=csv" className="btn">Questions as spreadsheet (.csv)</a>
          </div>
        </Section>
        <Section title="Restore">
          <RestoreForm />
        </Section>
      </div>
      <div className="mt-4">
        <Section title={`Import batches (${batches.length})`}>
          <BatchList batches={batches} />
        </Section>
      </div>
    </>
  );
}
