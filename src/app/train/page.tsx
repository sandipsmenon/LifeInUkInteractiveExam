import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { allFacts, confusableGroups, datedFacts, nameFacts, numberFacts } from "@/lib/facts";
import { loadFactSources } from "@/lib/server/training";

export const dynamic = "force-dynamic";
export const metadata = { title: "Memory training" };

export default async function TrainPage() {
  const sources = await loadFactSources();
  const tools = [
    { kind: "timeline", title: "Date timeline", text: "Put events in chronological order and match events to their years.", n: datedFacts(sources).length, min: 3, unit: "dated facts" },
    { kind: "numbers", title: "Number drill", text: "Type the figure from memory: members, ages, percentages, fines.", n: numberFacts(sources).length, min: 1, unit: "numerical facts" },
    { kind: "names", title: "Name recall", text: "Match people to what they did, their title or role.", n: nameFacts(sources).length, min: 3, unit: "people" },
    { kind: "matching", title: "Question ↔ answer matching", text: "Match a set of questions to their answers.", n: allFacts(sources).length, min: 3, unit: "questions" },
    { kind: "compare", title: "Similar-fact comparison", text: "Tell apart facts that are easy to mix up (start vs end dates, similar wording).", n: confusableGroups(sources).length, min: 1, unit: "confusable pairs" },
    { kind: "flashcards", title: "Flashcards", text: "Flip a card, recall, and rate yourself. Ratings update your revision schedule.", n: sources.length, min: 1, unit: "cards" },
  ];
  return (
    <>
      <PageHeader
        title="Memory training"
        description="Exercises are generated only from facts in your own questions. Every item links back to the question it came from, and the original text is never rewritten."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tools.map((t) => {
          const ok = t.n >= t.min;
          return (
            <div key={t.kind} className="card flex flex-col p-5">
              <h2 className="font-semibold">{t.title}</h2>
              <p className="mt-1 flex-1 text-sm text-ink-2">{t.text}</p>
              <p className="mt-3 text-xs text-muted">{t.n} {t.unit} available</p>
              {ok ? (
                <Link href={`/train/${t.kind}`} className="btn btn-primary mt-3">Start</Link>
              ) : (
                <p className="mt-3 text-xs text-warn">Not enough data yet — import more questions.</p>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
