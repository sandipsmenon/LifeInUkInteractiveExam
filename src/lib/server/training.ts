import "server-only";
import type { FactSource } from "@/lib/facts";
import { query } from "./db";

export async function loadFactSources(): Promise<FactSource[]> {
  const rows = await query(
    `SELECT q.id, q.prompt, q.options, q.correct_keys, q.topics, q.mock_exam_number, q.question_number,
            coalesce(array(SELECT c.slug FROM question_categories qc JOIN categories c ON c.id = qc.category_id
                           WHERE qc.question_id = q.id), '{}') AS categories
     FROM questions q ORDER BY q.mock_exam_number NULLS LAST, q.question_number NULLS LAST, q.source_position`,
  );
  return rows.map((r) => ({
    id: r.id,
    prompt: r.prompt,
    options: r.options,
    correctKeys: r.correct_keys,
    categories: r.categories,
    topics: r.topics ?? [],
    mockExamNumber: r.mock_exam_number,
    questionNumber: r.question_number,
  }));
}
