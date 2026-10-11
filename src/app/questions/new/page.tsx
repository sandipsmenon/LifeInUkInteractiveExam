import { QuestionEditor } from "@/components/questions/editor";
import { PageHeader, Section } from "@/components/ui";
import { listCategories } from "@/lib/server/questions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Add question" };

export default async function NewQuestionPage() {
  const categories = await listCategories();
  return (
    <>
      <PageHeader title="Add a question" description="Manually added questions work exactly like imported ones." />
      <Section title="Question">
        <QuestionEditor categories={categories.filter((c) => c.slug !== "uncategorised")} />
      </Section>
    </>
  );
}
