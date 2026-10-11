import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, readJson } from "@/lib/server/http";
import { addFlag, flagSchema } from "@/lib/server/questions";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await addFlag(z.string().uuid().parse((await params).id), flagSchema.parse(await readJson(req)));
    return NextResponse.json({ ok: true }, { status: 201 });
  });
}
