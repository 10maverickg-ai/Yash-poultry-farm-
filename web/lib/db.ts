import { Pool, types } from "pg";

// Return Postgres DATE columns as plain 'YYYY-MM-DD' strings instead of JS
// Date objects — avoids timezone off-by-one on register dates, and every
// date in this system is a calendar date, never a timestamp.
types.setTypeParser(types.builtins.DATE, (v) => v);

declare global {
  var pgPool: Pool | undefined;
}

// The localhost default exists ONLY for local development. In production a
// missing DATABASE_URL must fail loudly at startup — the silent fallback
// once sent a deployed app to 127.0.0.1:5432 and surfaced as a baffling
// intermittent ECONNREFUSED instead of a config error.
function connectionString(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.NODE_ENV === "production")
    throw new Error(
      "DATABASE_URL is not set. Configure it (pooled connection string, with " +
        "?sslmode=require) in the deployment environment and redeploy — env " +
        "var edits do not apply to already-built deployments."
    );
  return "postgres://yash:yash_dev_password@localhost:5432/yash_poultry";
}

// One pool per process; survive Next.js dev-mode hot reloads via globalThis.
// max is kept small because on serverless (Vercel) each function instance
// gets its own pool — use the provider's POOLED connection string as
// DATABASE_URL there, with ?sslmode=require (node-postgres honors it from
// the URL).
export const pool: Pool =
  global.pgPool ??
  new Pool({
    connectionString: connectionString(),
    max: 5,
  });
if (process.env.NODE_ENV !== "production") global.pgPool = pool;

/** Run fn inside a transaction; rolls back on any throw. */
export async function withTransaction<T>(
  fn: (client: import("pg").PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
