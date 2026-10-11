import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/server/http";
import { restoreOriginal } from "@/lib/server/questions";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await restoreOriginal(z.string().uuid().parse((await params).id));
    return NextResponse.json({ ok: true });
  });
}
