#!/usr/bin/env node
/**
 * Creates or resets an internal operator login (there is no public signup).
 * Usage:
 *   npm run operator:create -- you@example.com "Your Password Here"
 *
 * If the account already exists the password is UPDATED (a reset).
 * The password is hashed with scrypt exactly like src/lib/auth/session.ts
 * and only the hash is stored. The plain password is never saved anywhere.
 */
import { randomBytes, scryptSync } from "node:crypto";
import pg from "pg";

const [email, password] = process.argv.slice(2);
if (!email || !password || !email.includes("@")) {
  console.error('Usage: npm run operator:create -- you@example.com "Your Password"');
  process.exit(1);
}
if (password.length < 8) {
  console.error("Please use a password of at least 8 characters.");
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    "DATABASE_URL is not set. Start the database (npm run db:start), run\n" +
      "the migration (npm run db:migrate), and load your .env.local variables.\n" +
      "See docs/operator-guide.md for the exact steps."
  );
  process.exit(1);
}

// Same hash format as src/lib/auth/session.ts
const salt = randomBytes(16).toString("hex");
const derived = scryptSync(password, salt, 64).toString("hex");
const stored = `scrypt:${salt}:${derived}`;

const pool = new pg.Pool({ connectionString, max: 1 });
try {
  const result = await pool.query(
    `INSERT INTO users (id, email, password_hash, role)
     VALUES ($1, $2, $3, 'operator')
     ON CONFLICT (email)
     DO UPDATE SET password_hash = EXCLUDED.password_hash
     RETURNING id, email, (xmax = 0) AS inserted`,
    [`user_${randomBytes(12).toString("hex")}`, email.toLowerCase().trim(), stored]
  );
  const row = result.rows[0];
  console.log(
    row.inserted
      ? `Operator account created for ${row.email}. You can now sign in at /login.`
      : `Password reset for ${row.email}. Sign in at /login with the new password.`
  );
  // Housekeeping: drop any stale sessions so a reset takes effect immediately.
  await pool.query("DELETE FROM sessions WHERE user_id = $1", [row.id]);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("does not exist")) {
    console.error(
      "The users table does not exist yet. Run the migration first: npm run db:migrate"
    );
  } else {
    console.error("Failed:", message);
  }
  process.exit(1);
} finally {
  await pool.end();
}
