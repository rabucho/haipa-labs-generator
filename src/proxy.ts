import { NextResponse, type NextRequest } from "next/server";

/**
 * Cheap edge gate (Slice 9, migrated to the Next.js 16 `proxy` convention in
 * Slice 19): redirects unauthenticated page requests to /login and returns
 * 401 JSON for unauthenticated /api calls. This checks cookie PRESENCE only —
 * full server-side session verification happens in route handlers and pages
 * via requireAuthenticatedOperator().
 */
const PUBLIC_EXACT = ["/login", "/api/auth/login", "/preview"];
const PUBLIC_PREVIEW = /^\/projects\/[^/]+\/preview$/;

export default function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLIC_EXACT.includes(pathname) || PUBLIC_PREVIEW.test(pathname)) {
    return NextResponse.next();
  }
  if (req.cookies.get("haipa_session")?.value) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json(
      { ok: false, errors: ["Authentication required."] },
      { status: 401 }
    );
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};