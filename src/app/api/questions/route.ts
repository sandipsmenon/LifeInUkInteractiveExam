import { NextResponse } from "next/server";
import { handle, readJson } from "@/lib/server/http";
import { createQuestion, listQuestions, questionFiltersSchema, questionInputSchema } from "@/lib/server/questions";

export async function GET(req: Request) {
  return handle(async () => {
    const filters = questionFiltersSchema.parse(Object.fromEntries(new URL(req.url).searchParams));
    return NextResponse.json(await listQuestions(filters));
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const id = await createQuestion(questionInputSchema.parse(await readJson(req)));
    return NextResponse.json({ id }, { status: 201 });
  });
}
