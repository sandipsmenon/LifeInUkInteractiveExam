import { NextResponse } from "next/server";
import { handle, readJson } from "@/lib/server/http";
import { startSchema, startSession } from "@/lib/server/practice";

export async function POST(req: Request) {
  return handle(async () => NextResponse.json(await startSession(startSchema.parse(await readJson(req))), { status: 201 }));
}
