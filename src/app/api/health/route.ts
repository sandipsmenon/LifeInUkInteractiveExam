import { NextResponse } from "next/server";
import { query } from "@/lib/server/db";

export const dynamic = "force-dynamic";

/** Public health check: reports whether the database is reachable, without exposing any data. */
export async function GET() {
  try {
    await query("SELECT 1");
    return NextResponse.json({ ok: true, database: "ok" });
  } catch (err) {
    console.error("[health]", err);
    return NextResponse.json({ ok: false, database: "unreachable" }, { status: 503 });
  }
}
