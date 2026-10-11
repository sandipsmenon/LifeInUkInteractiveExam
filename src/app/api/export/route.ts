import { NextResponse } from "next/server";
import { exportAll, exportQuestionsCsv } from "@/lib/server/backup";
import { handle } from "@/lib/server/http";

export async function GET(req: Request) {
  return handle(async () => {
    const stamp = new Date().toISOString().slice(0, 10);
    if (new URL(req.url).searchParams.get("format") === "csv") {
      return new NextResponse(await exportQuestionsCsv(), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="life-in-uk-questions-${stamp}.csv"`,
          "cache-control": "no-store",
        },
      });
    }
    return new NextResponse(JSON.stringify(await exportAll(), null, 1), {
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="life-in-uk-backup-${stamp}.json"`,
        "cache-control": "no-store",
      },
    });
  });
}
