import { NextResponse } from "next/server";
import { handle, jsonError } from "@/lib/server/http";
import { MAX_UPLOAD_BYTES, previewImport } from "@/lib/server/importer";

export async function POST(req: Request) {
  return handle(async () => {
    const len = Number(req.headers.get("content-length") ?? 0);
    if (len > MAX_UPLOAD_BYTES + 100_000) return jsonError("The file is larger than 5 MB.", 413);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonError("Choose a file to upload.", 400);
    const marker = form.get("markerStyle");
    const markerStyle = marker === "bold" || marker === "highlight" ? marker : undefined;
    // The file is parsed in memory and never written to disk or storage.
    const bytes = new Uint8Array(await file.arrayBuffer());
    return NextResponse.json(await previewImport(file.name, bytes, markerStyle));
  });
}
