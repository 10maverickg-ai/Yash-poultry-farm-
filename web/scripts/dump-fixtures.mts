// Writes the JSON fixture files the check scripts read (fixtureInput.mts) from a database, read-only.
//   npx tsx scripts/dump-fixtures.mts <out-dir>            (database: DATABASE_URL, default = the local copy)
// The check scripts then derive their expected values from these files, so they hold on any refresh date.
import { mkdirSync, writeFileSync } from "node:fs";
import pg from "pg";

const out = process.argv[2];
if (!out) throw new Error("usage: dump-fixtures.mts <out-dir>");
pg.types.setTypeParser(1082, (v: string) => v); // DATE as plain YYYY-MM-DD
pg.types.setTypeParser(1700, (v: string) => Number(v)); // numeric as number
pg.types.setTypeParser(20, (v: string) => Number(v)); // bigint as number
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://yash:yash_dev_password@localhost:5432/yash_poultry" });
mkdirSync(out, { recursive: true });
const Q: Record<string, string> = {
  flocks: `SELECT flock_internal_id, display_label, breed, placement_date, placement_date_confirmed, status, segment, placement_is_chick_date FROM flocks ORDER BY display_label`,
  dp: `SELECT id, date, flock_internal_id, display_label_as_written AS lbl, mortality, feed_bags, eggs_total, bird_population, hd_percent, flagged, reviewed_by_owner FROM daily_production WHERE deleted_at IS NULL ORDER BY date, id`,
  movements: `SELECT id, date, flock_internal_id, birds_change, movement_type, needs_review, reviewed_by_owner FROM flock_movements ORDER BY id`,
  egg: `SELECT id, date, section, total_eggs_produced AS tp, opening_balance_eggs AS ob, closing_balance_eggs AS cb, reviewed_by_owner, flagged FROM daily_egg_stock_summary WHERE deleted_at IS NULL ORDER BY date, section`,
  feedbox: `SELECT id, date, flock_group AS g, opening_balance_bags AS ob, produced_bags AS prod, consumed_bags AS cons, closing_balance_bags AS cb, reviewed_by_owner, flagged FROM daily_feed_bag_stock WHERE deleted_at IS NULL ORDER BY date, id`,
  junction: `SELECT j.feed_bag_stock_id, j.flock_internal_id FROM daily_feed_bag_stock_flocks j JOIN daily_feed_bag_stock b ON b.id = j.feed_bag_stock_id WHERE b.deleted_at IS NULL ORDER BY 1, 2`,
  moulting: `SELECT id, flock_internal_id, start_date, end_date, confirmed_by_owner FROM moulting_periods ORDER BY id`,
  chick: `SELECT date, sum(deaths)::int AS d FROM chick_daily_mortality GROUP BY date ORDER BY date`,
  eggweights: `SELECT flock_internal_id, date::text AS date, avg_egg_weight_g::float AS g FROM egg_weight_samples ORDER BY date`,
  bv: `SELECT age_weeks, std_hdp_percent, feed_per_day_g, cumulative_depletion_percent, cur_hhp_percent, cum_hhp_eggs, egg_weight_g, current_feed_per_egg_g FROM bv300_standard_laying WHERE guide_version = '2023' ORDER BY age_weeks`,
  deductions: `SELECT s.date, e.category, s.section, abs(e.amount_eggs) AS eggs FROM daily_egg_stock_entries e JOIN daily_egg_stock_summary s ON s.id = e.egg_stock_summary_id WHERE s.deleted_at IS NULL AND e.category IN ('breakage','other','labour_take','cross_farm_adjustment','gift') ORDER BY s.date, e.sequence_order`,
  sales: `SELECT date, eggs_quantity AS eggs, amount FROM sales ORDER BY date, id`,
  sales_full: `SELECT id, date, transaction_type::text AS tt, buyer_or_recipient AS b, grade AS g, eggs_quantity AS e, price_per_unit AS p, amount AS a FROM sales ORDER BY date, id`,
  overrides: `SELECT grp, metric, band_start, ratio_pct, note FROM realistic_target_overrides ORDER BY id`,
  // V19: the feed formulas (each shed's price from the formula's date) and the farm's cost settings
  formulations: `SELECT id, code, name, effective_from, batch_kg, formula_cost_per_kg, production_loss_pct, production_cost_per_kg, bagging_cost_per_kg, delivered_cost_per_kg, ame_kcal_per_kg, target_intake_note, source, note FROM feed_formulations ORDER BY id`,
  formulation_ingredients: `SELECT formulation_id, ingredient, percent, kg_per_batch, rupees_per_kg FROM feed_formulation_ingredients ORDER BY formulation_id, percent DESC`,
  formulation_sheds: `SELECT formulation_id, flock_label FROM feed_formulation_sheds ORDER BY formulation_id, flock_label`,
  cost_settings: `SELECT cost_type, value, effective_from, month FROM cost_settings WHERE farm_code = 'YPF' ORDER BY effective_from, cost_type`,
};
for (const [name, sql] of Object.entries(Q)) writeFileSync(`${out}/${name}.json`, JSON.stringify((await pool.query(sql)).rows));
const ff = (await pool.query(`SELECT DISTINCT s.date, s.section FROM daily_egg_stock_entries e JOIN daily_egg_stock_summary s ON s.id = e.egg_stock_summary_id WHERE s.deleted_at IS NULL AND e.category = 'sale' ORDER BY 1`)).rows as { date: string; section: string }[];
writeFileSync(`${out}/farmfresh.json`, JSON.stringify([...new Set(ff.map((r) => r.date))]));
writeFileSync(`${out}/farmfresh_sec.json`, JSON.stringify({ big: ff.filter((r) => r.section === "big").map((r) => r.date), small: ff.filter((r) => r.section === "small").map((r) => r.date) }));
await pool.end();
console.log(`fixtures written to ${out}`);
