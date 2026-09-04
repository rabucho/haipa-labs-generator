import "server-only";

import { Pool } from "pg";

/**
 * PostgreSQL connection (Slice 9) — server-only singleton.
 * DATABASE_URL comes from the environment; never committed, never exposed
 * to the client. The pool is lazily created so importing this module without
 * a database configured does not open connections.
 */

let pool: Pool | null = null;

export function getDbPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL is not configured. Start the local database (docker compose up -d db) and set DATABASE_URL."
      );
    }
    pool = new Pool({ connectionString, max: 5 });
  }
  return pool;
}

/** True when database persistence is selected via REPOSITORY_BACKEND. */
export function isDatabaseBackend(): boolean {
  return process.env.REPOSITORY_BACKEND === "database";
}
