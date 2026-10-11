/**
 * Minimal single-user auth: one password (APP_PASSWORD) and an HMAC-signed, httpOnly session cookie.
 * Uses Web Crypto only, so it runs in the proxy as well as in route handlers.
 */
export const SESSION_COOKIE = "lifeuk_session";
export const SESSION_DAYS = 30;

const enc = new TextEncoder();

function secret(): string | null {
  return process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32 ? process.env.AUTH_SECRET : null;
}

export function authConfigured(): boolean {
  return !!process.env.APP_PASSWORD && !!secret();
}

/** Auth may only be skipped for local development when no password has been configured. */
export function authDisabled(): boolean {
  return !process.env.APP_PASSWORD && process.env.NODE_ENV !== "production";
}

async function hmac(data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret()!), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function createSessionToken(now = Date.now()): Promise<string> {
  const expires = now + SESSION_DAYS * 86_400_000;
  const payload = `v1.${expires}`;
  return `${payload}.${await hmac(payload)}`;
}

export async function verifySessionToken(token: string | undefined, now = Date.now()): Promise<boolean> {
  if (!token || !secret()) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return false;
  const expires = Number(parts[1]);
  if (!Number.isFinite(expires) || expires < now) return false;
  return timingSafeEqual(parts[2], await hmac(`${parts[0]}.${parts[1]}`));
}

export async function passwordMatches(candidate: string): Promise<boolean> {
  const expected = process.env.APP_PASSWORD;
  if (!expected || !secret()) return false;
  // Compare HMACs so the comparison time does not depend on where the strings differ.
  return timingSafeEqual(await hmac(`pw:${candidate}`), await hmac(`pw:${expected}`));
}
