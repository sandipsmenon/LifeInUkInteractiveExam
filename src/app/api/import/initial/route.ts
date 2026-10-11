import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { handle } from "@/lib/server/http";
import { previewImport } from "@/lib/server/importer";

const INITIAL_DATASET = "LifeInUk-mock-1-3.md";

/** Previews the bundled initial dataset (the converted Word document for mock tests 1-3). */
export async function POST(req: Request) {
  return handle(async () => {
    const bytes = await readFile(path.join(process.cwd(), "data", "initial", INITIAL_DATASET));
    const body = (await req.json().catch(() => ({}))) as { markerStyle?: string };
    const marker = body.markerStyle === "bold" || body.markerStyle === "highlight" ? body.markerStyle : undefined;
    return NextResponse.json(await previewImport(INITIAL_DATASET, new Uint8Array(bytes), marker));
  });
}
