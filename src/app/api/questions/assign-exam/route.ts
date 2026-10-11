import { NextResponse } from "next/server";
import { handle, readJson } from "@/lib/server/http";
import { assignExam, assignExamSchema } from "@/lib/server/questions";

export async function POST(req: Request) {
  return handle(async () => {
    await assignExam(assignExamSchema.parse(await readJson(req)));
    return NextResponse.json({ ok: true });
  });
}
