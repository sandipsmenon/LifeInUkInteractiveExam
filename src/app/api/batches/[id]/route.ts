import { NextResponse } from "next/server";
import { z } from "zod";
import { handle } from "@/lib/server/http";
import { deleteBatch } from "@/lib/server/importer";

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const id = z.string().uuid().parse((await params).id);
    const withQuestions = new URL(req.url).searchParams.get("withQuestions") === "1";
    await deleteBatch(id, withQuestions);
    return NextResponse.json({ ok: true });
  });
}
