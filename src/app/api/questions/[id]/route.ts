import { NextResponse } from "next/server";
import { z } from "zod";
import { handle, jsonError, readJson } from "@/lib/server/http";
import {
  deleteQuestion,
  getQuestion,
  patchQuestion,
  patchSchema,
  questionInputSchema,
  updateQuestion,
} from "@/lib/server/questions";

type Ctx = { params: Promise<{ id: string }> };
const idOf = async (ctx: Ctx) => z.string().uuid().parse((await ctx.params).id);

export async function GET(_req: Request, ctx: Ctx) {
  return handle(async () => {
    const q = await getQuestion(await idOf(ctx));
    return q ? NextResponse.json(q) : jsonError("Question not found.", 404);
  });
}

export async function PUT(req: Request, ctx: Ctx) {
  return handle(async () => {
    await updateQuestion(await idOf(ctx), questionInputSchema.parse(await readJson(req)));
    return NextResponse.json({ ok: true });
  });
}

export async function PATCH(req: Request, ctx: Ctx) {
  return handle(async () => {
    await patchQuestion(await idOf(ctx), patchSchema.parse(await readJson(req)));
    return NextResponse.json({ ok: true });
  });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  return handle(async () => {
    await deleteQuestion(await idOf(ctx));
    return NextResponse.json({ ok: true });
  });
}
