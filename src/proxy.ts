import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authConfigured, authDisabled, verifySessionToken } from "@/lib/auth/session";

const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/health"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // Basic CSRF protection: state-changing API calls must come from this site.
  if (isApi && !["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin");
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
    if (origin && host && new URL(origin).host !== host) {
      return NextResponse.json({ error: "Cross-site request blocked." }, { status: 403 });
    }
  }

  if (PUBLIC_PATHS.some((p) => pathname === p)) return NextResponse.next();
  if (authDisabled()) return NextResponse.next();
  if (!authConfigured()) {
    return new NextResponse(
      "This site is not configured: set APP_PASSWORD and AUTH_SECRET (32+ characters) in the environment.",
      { status: 503, headers: { "content-type": "text/plain" } },
    );
  }
  if (await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();

  if (isApi) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + request.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|robots.txt).*)"],
};
