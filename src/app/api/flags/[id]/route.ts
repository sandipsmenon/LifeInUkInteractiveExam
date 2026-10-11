import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/server/http";
import { resolveFlag } from "@/lib/server/questions";

export async function PATCH(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await resolveFlag(z.string().uuid().parse((await params).id));
    return NextResponse.json({ ok: true });
  });
}
