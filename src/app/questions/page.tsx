import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { QuestionList } from "@/components/questions/question-list";
import { PAGE_SIZE, listBatches, listCategories, listExams, listQuestions, listTopics, questionFiltersSchema } from "@/lib/server/questions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Question bank" };

type SP = Record<string, string | string[] | undefined>;

function Select({ name, label, value, options }: { name: string; label: string; value?: string; options: [string, string][] }) {
  return (
    <div>
      <label htmlFor={`f-${name}`} className="label">{label}</label>
      <select id={`f-${name}`} name={name} defaultValue={value ?? ""} className="input">
        <option value="">All</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </div>
  );
}

export default async function QuestionsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const raw = Object.fromEntries(Object.entries(await searchParams).filter(([, v]) => typeof v === "string" && v !== "")) as Record<string, string>;
  const parsed = questionFiltersSchema.safeParse(raw);
  const filters = parsed.success ? parsed.data : {};
  const [{ rows, total }, categories, topics, exams, batches] = await Promise.all([
    listQuestions(filters),
    listCategories(),
    listTopics(),
    listExams(),
    listBatches(),
  ]);
  const page = filters.page ?? 1;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (over: Record<string, string | number | undefined>) => {
    const p = new URLSearchParams({ ...raw, ...Object.fromEntries(Object.entries(over).map(([k, v]) => [k, String(v ?? "")])) });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/questions?${p}`;
  };
  const activeFilters = Object.keys(raw).filter((k) => k !== "page" && k !== "sort").length;

  return (
    <>
      <PageHeader
        title="Question bank"
        description={`${total} question${total === 1 ? "" : "s"}${activeFilters ? " match your filters" : ""}. Original mock exam and question numbers are kept for every question.`}
        actions={<Link href="/questions/new" className="btn">Add question</Link>}
      />
      <form method="get" className="card mb-4 grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4" role="search">
        <div className="sm:col-span-2">
          <label htmlFor="f-q" className="label">Search</label>
          <input id="f-q" name="q" defaultValue={filters.q} placeholder="Words in the question, answers, notes or topics" className="input" />
        </div>
        <Select name="category" label="Category" value={filters.category} options={categories.map((c) => [c.slug, `${c.name} (${c.questionCount})`])} />
        <Select name="topic" label="Topic" value={filters.topic} options={topics.map((t) => [t.topic, `${t.topic} (${t.count})`])} />
        <Select
          name="exam"
          label="Mock exam"
          value={filters.exam}
          options={exams.map((e) => [e.number === null ? "none" : String(e.number), e.number === null ? `Not assigned (${e.count})` : `Mock ${e.number} (${e.count})`])}
        />
        <Select name="batch" label="Imported batch" value={filters.batch} options={batches.map((b) => [b.id, `${b.label ?? b.filename} (${b.questionCount})`])} />
        <Select name="status" label="Revision status" value={filters.status} options={[["new", "New"], ["learning", "Learning"], ["needs_revision", "Needs revision"], ["mastered", "Mastered"]]} />
        <Select name="difficulty" label="Difficulty (personal)" value={filters.difficulty} options={[["hard", "Hard"], ["medium", "Medium"], ["easy", "Easy"], ["unrated", "Unrated"]]} />
        <Select name="type" label="Question type" value={filters.type} options={[["single", "Single answer"], ["multi", "Multiple answers"], ["true_false", "True / false"]]} />
        <Select
          name="mark"
          label="Marked"
          value={filters.mark}
          options={[["important", "Important"], ["confusing", "Confusing"], ["flagged", "Flagged"], ["edited", "Edited"], ["mock_incorrect", "Wrong in mock test"]]}
        />
        <div>
          <label htmlFor="f-sort" className="label">Sort by</label>
          <select id="f-sort" name="sort" defaultValue={filters.sort ?? "source"} className="input">
            <option value="source">Mock exam &amp; question number</option>
            <option value="hardest">Hardest for me</option>
            <option value="most_attempted">Most practised</option>
            <option value="due">Next review due</option>
            <option value="newest">Recently imported</option>
            <option value="alpha">Alphabetical</option>
          </select>
        </div>
        <div className="flex items-end gap-2">
          <button className="btn btn-primary flex-1">Apply</button>
          {activeFilters > 0 && <Link href="/questions" className="btn">Clear</Link>}
        </div>
      </form>

      <QuestionList rows={rows} />

      {pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-center gap-2 text-sm">
          {page > 1 && <Link className="btn btn-sm" href={qs({ page: page - 1 })}>Previous</Link>}
          <span className="text-ink-2">Page {page} of {pages}</span>
          {page < pages && <Link className="btn btn-sm" href={qs({ page: page + 1 })}>Next</Link>}
        </nav>
      )}
    </>
  );
}
