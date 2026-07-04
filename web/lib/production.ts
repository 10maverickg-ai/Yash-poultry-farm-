import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";

// One entry slot per flock whose display label is effective on the chosen
// date (via flock_label_history — mirrors what the paper register showed
// that day), left-joined with any row already saved for that date.
export interface ProductionSlot {
  flock_internal_id: string;
  display_label: string; // label as of that date, per history
  default_shed: string | null;
  saved: null | {
    shed_code: string | null;
    mortality: number | null;
    feed_bags: number | null;
    eggs_total: number | null;
    bird_population: number | null;
    hd_percent: string | null; // pg numeric comes back as string
    flagged: boolean;
    flag_reason: string | null;
  };
}

export async function getProductionSheet(date: string): Promise<ProductionSlot[]> {
  const { rows } = await pool.query(
    `SELECT h.display_label,
            f.flock_internal_id,
            f.current_shed AS default_shed,
            dp.id AS row_id,
            dp.shed_code, dp.mortality, dp.feed_bags, dp.eggs_total,
            dp.bird_population, dp.hd_percent, dp.flagged, dp.flag_reason
       FROM flock_label_history h
       JOIN flocks f USING (flock_internal_id)
       LEFT JOIN daily_production dp
         ON dp.flock_internal_id = f.flock_internal_id AND dp.date = $2
      WHERE f.farm_code = $1
        AND h.effective_from <= $2
        AND (h.effective_to IS NULL OR h.effective_to >= $2)
      ORDER BY h.display_label`,
    [ACTIVE_FARM, date]
  );
  return rows.map((r) => ({
    flock_internal_id: r.flock_internal_id,
    display_label: r.display_label,
    default_shed: r.default_shed,
    saved:
      r.row_id === null
        ? null
        : {
            shed_code: r.shed_code,
            mortality: r.mortality,
            feed_bags: r.feed_bags,
            eggs_total: r.eggs_total,
            bird_population: r.bird_population,
            hd_percent: r.hd_percent,
            flagged: r.flagged,
            flag_reason: r.flag_reason,
          },
  }));
}
