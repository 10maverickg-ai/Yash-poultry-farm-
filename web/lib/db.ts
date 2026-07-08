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

// SSL is decided HERE, explicitly — never left to pg's URL-parameter
// interpretation, which changed underneath us: recent pg versions escalate
// sslmode=require to full certificate verification, and managed-Postgres
// poolers (Supabase et al.) present provider-CA chains that fail Node's
// default trust store with SELF_SIGNED_CERT_IN_CHAIN.
//
// Behavior:
//   - no sslmode in the URL (local dev) or sslmode=disable -> no TLS
//   - any other sslmode -> TLS on:
//       - DATABASE_CA_CERT set (PEM, from the provider's dashboard) ->
//         full verification against that CA — the strongest option
//       - otherwise -> encrypted without chain verification, i.e. classic
//         libpq 'require' semantics (what sslmode=require always meant
//         before the pg change)
// The sslmode/uselibpqcompat params are stripped from the URL so pg cannot
// re-interpret them; the ssl option below is the single source of truth.
function poolConfig(): { connectionString: string; max: number; ssl: false | object } {
  const raw = connectionString();
  const qIdx = raw.indexOf("?");
  let url = raw;
  let sslmode: string | null = null;
  if (qIdx !== -1) {
    const params = new URLSearchParams(raw.slice(qIdx + 1));
    sslmode = params.get("sslmode");
    params.delete("sslmode");
    params.delete("uselibpqcompat");
    const rest = params.toString();
    url = rest ? `${raw.slice(0, qIdx)}?${rest}` : raw.slice(0, qIdx);
  }

  let ssl: false | object = false;
  if (sslmode && sslmode !== "disable") {
    const ca = process.env.DATABASE_CA_CERT;
    ssl = ca ? { ca, rejectUnauthorized: true } : { rejectUnauthorized: false };
  }
  return { connectionString: url, max: 5, ssl };
}

// One pool per process, created lazily on FIRST QUERY — never at import.
// `next build` loads these modules with NODE_ENV=production and no runtime
// env, so an import-time check would break every build. max is kept small
// because on serverless (Vercel) each function instance gets its own pool —
// use the provider's POOLED connection string as DATABASE_URL there.
let lazyPool: Pool | undefined = global.pgPool;

function getPool(): Pool {
  if (!lazyPool) {
    lazyPool = new Pool(poolConfig());
    // Survive Next.js dev-mode hot reloads.
    if (process.env.NODE_ENV !== "production") global.pgPool = lazyPool;
  }
  return lazyPool;
}

export const pool: Pool = new Proxy({} as Pool, {
  get(_target, prop) {
    const real = getPool() as unknown as Record<string | symbol, unknown>;
    const value = real[prop];
    return typeof value === "function" ? (value as CallableFunction).bind(real) : value;
  },
}) as Pool;

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
