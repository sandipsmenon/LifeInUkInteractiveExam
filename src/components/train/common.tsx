import Link from "next/link";

export function SourceLink({ questionId, label }: { questionId: string; label: string }) {
  return (
    <Link href={`/questions/${questionId}`} target="_blank" className="text-xs text-muted hover:underline" title="Open the source question">
      {label} ↗
    </Link>
  );
}

export function NotEnough({ what }: { what: string }) {
  return <div className="card p-6 text-center text-sm text-ink-2">Not enough {what} in your question bank for this exercise yet.</div>;
}

export async function recordRecall(questionId: string, mode: string, knew: boolean, confidence: 1 | 2 | 3 | null = null) {
  // Best effort: a failed save should not interrupt the drill, but it is reported in the console.
  try {
    const res = await fetch("/api/practice/attempts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ questionId, mode, selfMarkedCorrect: knew, confidence }),
    });
    if (!res.ok) console.error("Could not save result", await res.text());
    return res.ok;
  } catch (err) {
    console.error(err);
    return false;
  }
}
