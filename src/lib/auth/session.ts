import "server-only";

import { randomBytes, scryptSync, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { getDbPool } from "@/db/client";

/**
 * Server-verified session auth (Slice 9) — internal operator only.
 *
 * Mechanism: credentials checked against the `users` table (scrypt password
 * hashes, seeded from environment variables by the migration/seed script);
 * a random session token is stored server-side (sessions table) and sent as
 * an HttpOnly, SameSite=Lax cookie. No client-side flag is trusted. No
 * public signup: identities come from the configured operator allowlist.
 *
 * LIMITATION (documented): single-tenant internal tool — roles exist in the
 * schema but role administration is out of scope.
 */

export const SESSION_COOKIE = "haipa_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

export type AuthContext = {
  userId: string;
  email: string;
  role: "operator" | "admin";
};

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const derived = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return (
    derived.length === expected.length && timingSafeEqual(derived, expected)
  );
}

/** Verify credentials and create a server-side session. Returns the token. */
export async function login(
  email: string,
  password: string
): Promise<{ token: string; auth: AuthContext } | null> {
  const result = await getDbPool().query(
    "SELECT id, email, password_hash, role FROM users WHERE email = $1",
    [email.toLowerCase().trim()]
  );
  const user = result.rows[0] as
    | { id: string; email: string; password_hash: string; role: string }
    | undefined;
  if (!user || !verifyPassword(password, user.password_hash)) return null;

  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await getDbPool().query(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES ($1,$2,$3)",
    [token, user.id, expiresAt]
  );
  return {
    token,
    auth: {
      userId: user.id,
      email: user.email,
      role: user.role === "admin" ? "admin" : "operator",
    },
  };
}

/** Resolve the current operator from the session cookie, or null. */
export async function getOperator(): Promise<AuthContext | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const result = await getDbPool().query(
    `SELECT u.id, u.email, u.role FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > now()`,
    [token]
  );
  const row = result.rows[0] as
    | { id: string; email: string; role: string }
    | undefined;
  if (!row) return null;
  return {
    userId: row.id,
    email: row.email,
    role: row.role === "admin" ? "admin" : "operator",
  };
}

/** Invalidate the current session and clear the cookie. */
export async function logout(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await getDbPool().query("DELETE FROM sessions WHERE token = $1", [token]);
  }
  store.delete(SESSION_COOKIE);
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  };
}
