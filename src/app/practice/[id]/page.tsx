import { notFound } from "next/navigation";
import { PracticeRunner } from "@/components/practice/runner";
import { getSession, sessionResults } from "@/lib/server/practice";

export const dynamic = "force-dynamic";
export const metadata = { title: "Practice session" };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession(id);
  if (!session) notFound();
  const results = session.finishedAt ? await sessionResults(id) : null;
  return <PracticeRunner session={session} initialResults={results} />;
}
