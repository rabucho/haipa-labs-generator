#!/usr/bin/env node
/**
 * Applies the database schema (src/db/schema.sql). Idempotent: uses
 * IF NOT EXISTS everywhere and is safe to run any number of times.
 * Usage: npm run db:migrate
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error(
    "DATABASE_URL is not set. Copy .env.example to .env.local and fill it in,\n" +
      "then run this script with the variables loaded (see docs/operator-guide.md)."
  );
  process.exit(1);
}

const sqlPath = path.join(process.cwd(), "src", "db", "schema.sql");
const sql = readFileSync(sqlPath, "utf-8");

const pool = new pg.Pool({ connectionString, max: 1 });
try {
  await pool.query(sql);
  const counts = await pool.query(`
    SELECT
      (SELECT count(*) FROM users)        AS users,
      (SELECT count(*) FROM projects)     AS projects,
      (SELECT count(*) FROM project_drafts) AS drafts;
  `);
  const c = counts.rows[0];
  console.log(`Schema applied successfully.`);
  console.log(`Current rows - users: ${c.users}, projects: ${c.projects}, drafts: ${c.drafts}`);
  if (Number(c.users) === 0) {
    console.log("");
    console.log("No operator account exists yet.");
    console.log("Create one with:  npm run operator:create -- you@example.com yourpassword");
  }
} catch (error) {
  console.error("Migration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
} finally {
  await pool.end();
}
