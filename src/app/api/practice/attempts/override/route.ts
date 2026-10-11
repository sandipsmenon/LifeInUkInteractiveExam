import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/lib/server/http";
import { overrideLastAttempt } from "@/lib/server/practice";

export async function POST(req: Request) {
  return handle(async () => {
    const input = z
      .object({ questionId: z.string().uuid(), sessionId: z.string().uuid().nullable(), isCorrect: z.boolean() })
      .parse(await readJson(req));
    return NextResponse.json(await overrideLastAttempt(input.questionId, input.sessionId, input.isCorrect));
  });
}
