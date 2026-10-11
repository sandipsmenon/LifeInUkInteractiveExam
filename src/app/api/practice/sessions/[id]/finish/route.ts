import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/server/http";
import { finishSession, sessionResults } from "@/lib/server/practice";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const id = z.string().uuid().parse((await params).id);
    await finishSession(id);
    return NextResponse.json({ results: await sessionResults(id) });
  });
}
