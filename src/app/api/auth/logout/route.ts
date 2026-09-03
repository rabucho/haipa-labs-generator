import { NextResponse } from "next/server";
import { logout } from "@/lib/auth/session";

/** POST /api/auth/logout — destroys the server-side session and cookie. */
export async function POST() {
  try {
    await logout();
  } catch {
    // Session cleanup failures still clear the cookie below.
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("haipa_session", "", { httpOnly: true, path: "/", maxAge: 0 });
  return res;
}
