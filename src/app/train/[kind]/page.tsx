import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientOnly } from "@/components/client-only";
import { CompareDrill } from "@/components/train/compare";
import { Flashcards } from "@/components/train/flashcards";
import { MatchingGame } from "@/components/train/matching";
import { NumberDrill } from "@/components/train/numbers";
import { Timeline } from "@/components/train/timeline";
import { allFacts, confusableGroups, datedFacts, nameFacts, numberFacts } from "@/lib/facts";
import { listCategories } from "@/lib/server/questions";
import { loadFactSources } from "@/lib/server/training";

export const dynamic = "force-dynamic";

const TITLES: Record<string, string> = {
  timeline: "Date timeline",
  numbers: "Number drill",
  names: "Name recall",
  matching: "Question ↔ answer matching",
  compare: "Similar-fact comparison",
  flashcards: "Flashcards",
};

export async function generateMetadata({ params }: { params: Promise<{ kind: string }> }) {
  return { title: TITLES[(await params).kind] ?? "Training" };
}

export default async function TrainKindPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!TITLES[kind]) notFound();
  const sources = await loadFactSources();
  let body: React.ReactNode;
  switch (kind) {
    case "timeline":
      body = <Timeline facts={datedFacts(sources)} />;
      break;
    case "numbers":
      body = <NumberDrill facts={numberFacts(sources)} />;
      break;
    case "names":
      body = <MatchingGame facts={nameFacts(sources)} leftLabel="Description" rightLabel="Person" />;
      break;
    case "matching":
      body = <MatchingGame facts={allFacts(sources)} leftLabel="Question" rightLabel="Answer" />;
      break;
    case "compare":
      body = <CompareDrill groups={confusableGroups(sources)} />;
      break;
    case "flashcards": {
      const categories = await listCategories();
      body = (
        <Flashcards
          cards={sources.map((s) => ({
            questionId: s.id,
            prompt: s.prompt,
            answer: s.options.filter((o) => s.correctKeys.includes(o.key)).map((o) => o.text).join("; "),
            ref: s.mockExamNumber ? `Mock ${s.mockExamNumber}${s.questionNumber ? ` · Q${s.questionNumber}` : ""}` : "Unassigned",
            categories: s.categories,
          }))}
          categories={categories.filter((c) => (c.questionCount ?? 0) > 0).map((c) => ({ slug: c.slug, name: c.name }))}
        />
      );
      break;
    }
  }
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold">{TITLES[kind]}</h1>
        <Link href="/train" className="text-sm text-ink-2 hover:underline">All exercises</Link>
      </div>
      {/* Exercises shuffle randomly, so they render in the browser only. */}
      <ClientOnly fallback={<p className="py-10 text-center text-sm text-muted">Preparing exercise…</p>}>{body}</ClientOnly>
    </div>
  );
}
