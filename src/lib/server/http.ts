import "server-only";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { DatabaseNotConfiguredError } from "./db";
import { ImportError } from "./importer";
import { PracticeError } from "./practice";
import { DuplicateQuestionError } from "./questions";

export function jsonError(message: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

/** Wraps a route handler with consistent, non-leaky error responses. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return jsonError(first ? `${first.path.join(".") || "input"}: ${first.message}` : "Invalid input.", 400);
    }
    if (err instanceof ImportError || err instanceof PracticeError) return jsonError(err.message, err.status);
    if (err instanceof DuplicateQuestionError) return jsonError(err.message, 409, { existingId: err.existingId });
    if (err instanceof DatabaseNotConfiguredError) return jsonError(err.message, 503);
    if (err instanceof SyntaxError) return jsonError("Request body is not valid JSON.", 400);
    console.error("[api] unexpected error", err);
    return jsonError("Something went wrong on the server. Your data was not changed.", 500);
  }
}

export async function readJson(req: Request, maxBytes = 2_000_000): Promise<unknown> {
  const text = await req.text();
  if (text.length > maxBytes) throw new ImportError("Request is too large.", 413);
  return JSON.parse(text);
}
