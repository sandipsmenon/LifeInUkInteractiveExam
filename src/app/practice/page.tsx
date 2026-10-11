import { PageHeader } from "@/components/ui";
import { PracticeLauncher } from "@/components/practice/launcher";
import { query } from "@/lib/server/db";
import { listBatches, listCategories, listExams } from "@/lib/server/questions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Practice" };

export default async function PracticePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const [categories, exams, batches, due] = await Promise.all([
    listCategories(),
    listExams(),
    listBatches(),
    query("SELECT count(*)::int AS n FROM review_states WHERE reps > 0 AND due_at <= now()"),
  ]);
  return (
    <>
      <PageHeader title="Practice" description="Pick a mode. Every answer updates your progress and revision schedule." />
      <PracticeLauncher
        initialMode={sp.mode}
        initialCategory={sp.category}
        initialExam={sp.exam}
        categories={categories.filter((c) => (c.questionCount ?? 0) > 0)}
        exams={exams.filter((e) => e.number !== null).map((e) => ({ number: e.number!, count: e.count }))}
        unassigned={exams.find((e) => e.number === null)?.count ?? 0}
        batches={batches.map((b) => ({ id: b.id, label: b.label ?? b.filename, count: b.questionCount }))}
        due={due[0].n}
      />
    </>
  );
}
