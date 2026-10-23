import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { compareLabels } from "@/lib/naturalSort";

// One day of the farm, read-only: flock rows (real flock name first, register
// label as secondary text), chick-shed deaths, bird movements and the egg
// ledger summary. Rows are matched to flocks by flock_internal_id only.
export interface DayFlockRow {
  id: number;
  flockId: string;
  flockName: string; // flocks.display_label: the real flock
  registerLabel: string | null; // as written in the register that day
  placement: string | null;
  mortality: number | null;
  feed: number | null;
  eggs: number | null;
  birds: number | null;
  hdCalc: number | null; // eggs / birds * 100
  hdWritten: number | null; // supervisor's % (small, optional)
  flagged: boolean;
  reviewed: boolean;
  flagReason: string | null;
}
export interface DayMovement {
  id: number;
  flockName: string;
  change: number;
  type: string;
  buyer: string | null;
  pricePerBird: number | null;
  reason: string | null;
  needsReview: boolean;
}
export interface DayData {
  date: string;
  rows: DayFlockRow[];
  chick: { position: number; label: string; deaths: number; note: string | null }[];
  movements: DayMovement[];
  ledger: { section: string; produced: number | null; opening: number | null; closing: number | null; flagged: boolean }[];
  prevDate: string | null;
  nextDate: string | null;
}

export const hdOf = (eggs: number | null, birds: number | null) =>
  eggs != null && birds != null && birds > 0 ? (eggs / birds) * 100 : null;

export async function listProductionDates(): Promise<string[]> {
  const { rows } = await pool.query(
    `SELECT DISTINCT date FROM daily_production WHERE farm_code = $1 AND deleted_at IS NULL ORDER BY date`,
    [ACTIVE_FARM]
  );
  return rows.map((r) => r.date);
}

export async function loadDay(date: string): Promise<DayData> {
  const [prod, chick, mov, led, nav] = await Promise.all([
    pool.query(
      `SELECT dp.id, dp.flock_internal_id, f.display_label AS flock_name, f.placement_date,
              dp.display_label_as_written, dp.mortality, dp.feed_bags, dp.eggs_total,
              dp.bird_population, dp.hd_percent_written, dp.flagged, dp.flag_reason,
              dp.reviewed_by_owner
         FROM daily_production dp
         JOIN flocks f USING (flock_internal_id)
        WHERE dp.farm_code = $1 AND dp.date = $2 AND dp.deleted_at IS NULL`,
      [ACTIVE_FARM, date]
    ),
    pool.query(
      `SELECT row_position, label_as_written, deaths, chick_batch_note
         FROM chick_daily_mortality WHERE farm_code = $1 AND date = $2 ORDER BY row_position`,
      [ACTIVE_FARM, date]
    ),
    pool.query(
      `SELECT m.id, f.display_label AS flock_name, m.birds_change, m.movement_type, m.buyer,
              m.price_per_bird, m.reason, m.needs_review
         FROM flock_movements m JOIN flocks f USING (flock_internal_id)
        WHERE m.farm_code = $1 AND m.date = $2 ORDER BY m.id`,
      [ACTIVE_FARM, date]
    ),
    pool.query(
      `SELECT section, total_eggs_produced, opening_balance_eggs, closing_balance_eggs, flagged
         FROM daily_egg_stock_summary
        WHERE farm_code = $1 AND date = $2 AND deleted_at IS NULL ORDER BY section`,
      [ACTIVE_FARM, date]
    ),
    pool.query(
      `SELECT (SELECT max(date) FROM daily_production WHERE farm_code=$1 AND deleted_at IS NULL AND date < $2) AS prev,
              (SELECT min(date) FROM daily_production WHERE farm_code=$1 AND deleted_at IS NULL AND date > $2) AS next`,
      [ACTIVE_FARM, date]
    ),
  ]);
  const rows: DayFlockRow[] = prod.rows
    .map((r) => ({
      id: Number(r.id),
      flockId: r.flock_internal_id,
      flockName: r.flock_name,
      registerLabel: r.display_label_as_written,
      placement: r.placement_date ? String(r.placement_date).slice(0, 10) : null,
      mortality: r.mortality,
      feed: r.feed_bags,
      eggs: r.eggs_total,
      birds: r.bird_population,
      hdCalc: hdOf(r.eggs_total, r.bird_population),
      hdWritten: r.hd_percent_written != null ? Number(r.hd_percent_written) : null,
      flagged: r.flagged,
      reviewed: r.reviewed_by_owner,
      flagReason: r.flag_reason,
    }))
    .sort((a, b) => compareLabels(a.flockName, b.flockName));
  return {
    date,
    rows,
    chick: chick.rows.map((c) => ({ position: c.row_position, label: c.label_as_written, deaths: c.deaths, note: c.chick_batch_note })),
    movements: mov.rows.map((m) => ({
      id: Number(m.id),
      flockName: m.flock_name,
      change: m.birds_change,
      type: m.movement_type,
      buyer: m.buyer,
      pricePerBird: m.price_per_bird != null ? Number(m.price_per_bird) : null,
      reason: m.reason,
      needsReview: m.needs_review,
    })),
    ledger: led.rows.map((l) => ({
      section: l.section,
      produced: l.total_eggs_produced,
      opening: l.opening_balance_eggs,
      closing: l.closing_balance_eggs,
      flagged: l.flagged,
    })),
    prevDate: nav.rows[0].prev ?? null,
    nextDate: nav.rows[0].next ?? null,
  };
}
