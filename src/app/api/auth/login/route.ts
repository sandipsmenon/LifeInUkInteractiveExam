import { NextResponse } from "next/server";
import { z } from "zod";
import { SESSION_COOKIE, SESSION_DAYS, authConfigured, createSessionToken, passwordMatches } from "@/lib/auth/session";
import { handle, jsonError, readJson } from "@/lib/server/http";

export async function POST(req: Request) {
  return handle(async () => {
    if (!authConfigured()) return jsonError("Sign-in is not configured on the server (APP_PASSWORD / AUTH_SECRET).", 503);
    const { password } = z.object({ password: z.string().min(1).max(200) }).parse(await readJson(req));
    if (!(await passwordMatches(password))) {
      await new Promise((r) => setTimeout(r, 800)); // slow down guessing
      return jsonError("Incorrect password.", 401);
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set(SESSION_COOKIE, await createSessionToken(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: SESSION_DAYS * 86_400,
    });
    return res;
  });
}
