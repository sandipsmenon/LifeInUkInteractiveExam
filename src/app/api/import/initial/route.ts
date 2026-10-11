import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { handle } from "@/lib/server/http";
import { previewImport } from "@/lib/server/importer";

const INITIAL_DATASET = "LifeInUk-mock-1-3.md";

/** Previews the bundled initial dataset (the converted Word document for mock tests 1-3). */
export async function POST() {
  return handle(async () => {
    const bytes = await readFile(path.join(process.cwd(), "data", "initial", INITIAL_DATASET));
    return NextResponse.json(await previewImport(INITIAL_DATASET, new Uint8Array(bytes)));
  });
}
