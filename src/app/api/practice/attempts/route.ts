import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/lib/server/http";
import { attemptSchema, recordAttempt } from "@/lib/server/practice";

/** Accepts one attempt, or `{ attempts: [...] }` for an exam simulation submitted at the end. */
export async function POST(req: Request) {
  return handle(async () => {
    const body = await readJson(req);
    if (body && typeof body === "object" && "attempts" in body) {
      const { attempts } = z.object({ attempts: z.array(attemptSchema).min(1).max(200) }).parse(body);
      const results = [];
      for (const a of attempts) results.push(await recordAttempt(a));
      return NextResponse.json({ results });
    }
    return NextResponse.json(await recordAttempt(attemptSchema.parse(body)));
  });
}
