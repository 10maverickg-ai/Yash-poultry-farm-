/* eslint-disable @typescript-eslint/no-require-imports */
// Test helper (V12 N8): the sandbox database is on the same machine, so queries take well under 1 ms. The real app talks to Supabase over
// the internet. Preload this with NODE_OPTIONS="--require ./scripts/slowdb.cjs" and SLOWDB_MS=40 to add that delay to every query.
const ms = Number(process.env.SLOWDB_MS || 0);
if (ms > 0) {
  const pg = require("pg");
  const orig = pg.Client.prototype.query;
  pg.Client.prototype.query = function (...args) {
    const last = args[args.length - 1];
    if (typeof last === "function") { setTimeout(() => orig.apply(this, args), ms); return undefined; }
    return new Promise((resolve, reject) => setTimeout(() => { try { resolve(orig.apply(this, args)); } catch (e) { reject(e); } }, ms));
  };
}
