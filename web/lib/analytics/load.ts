import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { breedKey, type EngineInput } from "./engine";
import { isNeverFlaggedProduction } from "@/lib/neverFlag";

// Read-only. Pulls everything the analytics engine needs in one round of
// queries; soft-deleted rows are excluded exactly like every other query in
// this app. BV300 reference rows come from bv300_standard_laying
// (guide_version '2023'); when a flock's age or breed has no row there the
// engine reports "no reference loaded" rather than guessing.
const num = (x: unknown): number | null => (x == null ? null : Number(x));

export async function loadEngineInput(): Promise<EngineInput> {
  const [flocks, prod, mov, egg, box, junction, chick, std, moult, ff, kstd, segHist] = await Promise.all([
    pool.query(
      `SELECT flock_internal_id, display_label, breed, placement_date, placement_date_confirmed, segment
         FROM flocks WHERE farm_code = $1`,
      [ACTIVE_FARM]
    ),
    pool.query(
      `SELECT id, date, flock_internal_id, display_label_as_written, mortality,
              feed_bags, eggs_total, bird_population, hd_percent, flagged,
              reviewed_by_owner, flag_reason
         FROM daily_production
        WHERE farm_code = $1 AND deleted_at IS NULL
        ORDER BY date, id`,
      [ACTIVE_FARM]
    ),
    pool.query(
      `SELECT id, date, flock_internal_id, birds_change, movement_type,
              needs_review, reviewed_by_owner
         FROM flock_movements WHERE farm_code = $1`,
      [ACTIVE_FARM]
    ),
    pool.query(
      `SELECT id, date, section, total_eggs_produced, opening_balance_eggs,
              closing_balance_eggs, reviewed_by_owner
         FROM daily_egg_stock_summary
        WHERE farm_code = $1 AND deleted_at IS NULL`,
      [ACTIVE_FARM]
    ),
    pool.query(
      `SELECT id, date, flock_group, opening_balance_bags, produced_bags,
              consumed_bags, closing_balance_bags, reviewed_by_owner
         FROM daily_feed_bag_stock
        WHERE farm_code = $1 AND deleted_at IS NULL`,
      [ACTIVE_FARM]
    ),
    pool.query(
      `SELECT j.feed_bag_stock_id, j.flock_internal_id
         FROM daily_feed_bag_stock_flocks j
         JOIN daily_feed_bag_stock b ON b.id = j.feed_bag_stock_id
        WHERE b.farm_code = $1 AND b.deleted_at IS NULL`,
      [ACTIVE_FARM]
    ),
    pool.query(
      `SELECT date, sum(deaths)::int AS deaths
         FROM chick_daily_mortality WHERE farm_code = $1 GROUP BY date`,
      [ACTIVE_FARM]
    ),
    pool.query(
      `SELECT age_weeks, std_hdp_percent
         FROM bv300_standard_laying WHERE guide_version = '2023'`
    ),
    pool.query(
      `SELECT m.flock_internal_id, m.start_date, m.end_date, m.confirmed_by_owner
         FROM moulting_periods m JOIN flocks f USING (flock_internal_id)
        WHERE f.farm_code = $1`,
      [ACTIVE_FARM]
    ),
    pool.query(
      `SELECT DISTINCT s.date, s.section FROM daily_egg_stock_entries e
         JOIN daily_egg_stock_summary s ON s.id = e.egg_stock_summary_id
        WHERE s.farm_code = $1 AND s.deleted_at IS NULL AND e.category = 'sale'`,
      [ACTIVE_FARM]
    ),
    // Other breeds' hen-day standards come from the knowledge library (entries that name a breed).
    pool.query(
      `SELECT e.breed, s.age_weeks, s.value
         FROM knowledge_standards s JOIN knowledge_entries e ON e.id = s.entry_id
        WHERE s.metric = 'hen_day_percent' AND e.breed IS NOT NULL`
    ),
    pool.query(`SELECT h.flock_internal_id, h.segment, h.effective_from FROM flock_segment_history h JOIN flocks f USING (flock_internal_id) WHERE f.farm_code = $1`, [ACTIVE_FARM]),
  ]);
  const histBy = new Map<string, { from: string; segment: "main" | "young" | null }[]>();
  for (const h of segHist.rows) (histBy.get(h.flock_internal_id) ?? histBy.set(h.flock_internal_id, []).get(h.flock_internal_id)!).push({ from: String(h.effective_from).slice(0, 10), segment: h.segment === "main" || h.segment === "young" ? h.segment : null });
  const stdByBreed: Record<string, { age: number; hdp: number }[]> = {};
  for (const r of kstd.rows) {
    const k = breedKey(r.breed);
    if (!k || k === "BV300") continue; // BV300 uses its own loaded table
    (stdByBreed[k] ??= []).push({ age: Number(r.age_weeks), hdp: Number(r.value) });
  }

  const flockIdsByBox = new Map<number, string[]>();
  for (const j of junction.rows) {
    const k = Number(j.feed_bag_stock_id);
    (flockIdsByBox.get(k) ?? flockIdsByBox.set(k, []).get(k)!).push(j.flock_internal_id);
  }

  return {
    flocks: flocks.rows.map((f) => ({
      id: f.flock_internal_id,
      label: f.display_label,
      breed: f.breed,
      placementDate: f.placement_date ? String(f.placement_date).slice(0, 10) : null,
      placementConfirmed: f.placement_date_confirmed === true,
      segment: f.segment === "main" || f.segment === "young" ? f.segment : null,
      segmentHistory: histBy.get(f.flock_internal_id),
    })),
    prod: prod.rows.map((r) => ({
      id: Number(r.id),
      date: r.date,
      flockId: r.flock_internal_id,
      label: r.display_label_as_written ?? "",
      mort: num(r.mortality),
      feed: num(r.feed_bags),
      eggs: num(r.eggs_total),
      pop: num(r.bird_population),
      hd: num(r.hd_percent),
      flagged: r.flagged,
      reviewed: r.reviewed_by_owner,
      neverFlag: r.flagged ? isNeverFlaggedProduction(r.date, r.flag_reason) : false,
    })),
    movements: mov.rows.map((m) => ({
      id: Number(m.id),
      date: m.date,
      flockId: m.flock_internal_id,
      change: m.birds_change,
      type: m.movement_type,
      needsReview: m.needs_review,
      reviewed: m.reviewed_by_owner,
    })),
    egg: egg.rows.map((e) => ({
      id: Number(e.id),
      date: e.date,
      section: e.section ?? "",
      produced: num(e.total_eggs_produced),
      opening: num(e.opening_balance_eggs),
      closing: num(e.closing_balance_eggs),
      reviewed: e.reviewed_by_owner,
    })),
    feedBoxes: box.rows.map((b) => ({
      id: Number(b.id),
      date: b.date,
      group: b.flock_group,
      opening: num(b.opening_balance_bags),
      produced: num(b.produced_bags),
      consumed: num(b.consumed_bags),
      closing: num(b.closing_balance_bags),
      reviewed: b.reviewed_by_owner,
      flockIds: flockIdsByBox.get(Number(b.id)) ?? [],
    })),
    farmfreshDates: [...new Set(ff.rows.map((r) => String(r.date).slice(0, 10)))],
    farmfreshBySection: {
      big: ff.rows.filter((r) => r.section === "big").map((r) => String(r.date).slice(0, 10)),
      small: ff.rows.filter((r) => r.section === "small").map((r) => String(r.date).slice(0, 10)),
    },
    moulting: moult.rows.map((m) => ({
      flockId: m.flock_internal_id,
      start: String(m.start_date).slice(0, 10),
      end: m.end_date ? String(m.end_date).slice(0, 10) : null,
      confirmed: m.confirmed_by_owner,
    })),
    chick: chick.rows.map((c) => ({ date: c.date, deaths: Number(c.deaths) })),
    std: std.rows.map((s) => ({ age: s.age_weeks, hdp: Number(s.std_hdp_percent) })),
    stdByBreed,
  };
}
