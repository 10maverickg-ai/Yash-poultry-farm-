import { Pool, types } from "pg";

// Return Postgres DATE columns as plain 'YYYY-MM-DD' strings instead of JS
// Date objects — avoids timezone off-by-one on register dates, and every
// date in this system is a calendar date, never a timestamp.
types.setTypeParser(types.builtins.DATE, (v) => v);

declare global {
  var pgPool: Pool | undefined;
}

// One pool per process; survive Next.js dev-mode hot reloads via globalThis.
export const pool: Pool =
  global.pgPool ??
  new Pool({
    connectionString:
      process.env.DATABASE_URL ??
      "postgres://yash:yash_dev_password@localhost:5432/yash_poultry",
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
