import { NextResponse } from "next/server";
import { restoreBackup } from "@/lib/server/backup";
import { handle, readJson } from "@/lib/server/http";

export async function POST(req: Request) {
  return handle(async () => NextResponse.json({ inserted: await restoreBackup(await readJson(req, 50_000_000)) }));
}
