import { NextResponse } from "next/server";
import { handle, readJson } from "@/lib/server/http";
import { commitImport, commitSchema } from "@/lib/server/importer";

export async function POST(req: Request) {
  return handle(async () => {
    const input = commitSchema.parse(await readJson(req, 10_000_000));
    return NextResponse.json(await commitImport(input));
  });
}
