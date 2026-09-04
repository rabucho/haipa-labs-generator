import { NextRequest, NextResponse } from "next/server";
import { login, sessionCookieOptions, SESSION_COOKIE } from "@/lib/auth/session";

/**
 * POST /api/auth/login — internal operator sign-in. Sets an HttpOnly session
 * cookie verified server-side against the sessions table. No public signup.
 */
export async function POST(req: NextRequest) {
  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as { email?: string; password?: string };
  } catch {
    return NextResponse.json({ ok: false, errors: ["Invalid JSON."] }, { status: 400 });
  }
  if (!body.email || !body.password) {
    return NextResponse.json(
      { ok: false, errors: ["Email and password are required."] },
      { status: 400 }
    );
  }

  try {
    const result = await login(body.email, body.password);
    if (!result) {
      // Same message for unknown user and wrong password — no account probing.
      return NextResponse.json(
        { ok: false, errors: ["Invalid credentials."] },
        { status: 401 }
      );
    }
    const res = NextResponse.json({ ok: true, email: result.auth.email });
    res.cookies.set(SESSION_COOKIE, result.token, sessionCookieOptions());
    return res;
  } catch (error) {
    // E.g. DATABASE_URL missing — redacted, no internals to the client.
    console.error("Login failed (redacted).");
    void error;
    return NextResponse.json(
      { ok: false, errors: ["Sign-in is unavailable. Is the database configured?"] },
      { status: 503 }
    );
  }
}
