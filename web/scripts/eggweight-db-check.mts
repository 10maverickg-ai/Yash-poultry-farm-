// V18 B3: an actual egg weight stored in egg_weight_samples reaches the FCR. Uses the database in DATABASE_URL and leaves nothing behind.
//   npx tsx scripts/eggweight-db-check.mts
import { pool } from "../lib/db";
import { loadEngineInput } from "../lib/analytics/load";
import { buildCtx } from "../lib/analytics/engine";
import { eggWeightFor, fcrLabel, flockFcr } from "../lib/analytics/fcr";

let bad = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (!cond) bad++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`); };
const flock = (await pool.query(`SELECT flock_internal_id AS id, display_label FROM flocks WHERE display_label = 'BAB-5'`)).rows[0];
const last = (await pool.query(`SELECT max(date)::text AS d FROM daily_production WHERE deleted_at IS NULL AND flock_internal_id = $1`, [flock.id])).rows[0].d as string;
const before = buildCtx(await loadEngineInput());
ok("no weighing stored: the standard egg weight is used", eggWeightFor(before, flock.id, last).source === "standard" && fcrLabel(flockFcr(before, flock.id, last).week) === "FCR (estimated from standard egg weight)");
const ins = await pool.query(`INSERT INTO egg_weight_samples (flock_internal_id, date, avg_egg_weight_g, eggs_weighed, note) VALUES ($1, $2, 61.5, 30, 'eggweight-db-check') RETURNING id`, [flock.id, last]);
try {
  const after = buildCtx(await loadEngineInput());
  const w = eggWeightFor(after, flock.id, last);
  ok("a stored weighing is loaded and preferred for that flock and day", w.source === "actual" && w.grams === 61.5, JSON.stringify(w));
  ok("the FCR label says which weight was used", /actual egg weight/.test(fcrLabel(flockFcr(after, flock.id, last).day)));
  const bad1 = await pool.query(`INSERT INTO egg_weight_samples (flock_internal_id, date, avg_egg_weight_g) VALUES ($1, $2, 0)`, [flock.id, "2026-01-02"]).then(() => "inserted", (e) => (e as { code?: string }).code);
  ok("the table refuses an impossible weight (0 g)", bad1 === "23514", String(bad1));
} finally {
  await pool.query(`DELETE FROM egg_weight_samples WHERE id = $1 OR note = 'eggweight-db-check'`, [ins.rows[0].id]);
}
ok("nothing is left behind", Number((await pool.query(`SELECT count(*) FROM egg_weight_samples WHERE note = 'eggweight-db-check'`)).rows[0].count) === 0);
await pool.end();
process.exit(bad ? 1 : 0);
