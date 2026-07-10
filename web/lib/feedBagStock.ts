import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";

export interface FeedBagGroupRow {
  id: number;
  flock_group: string;
  opening_balance_bags: number | null;
  produced_bags: number | null;
  total_bags: number | null;
  consumed_bags: number | null;
  mill_inventory_bags: number | null;
  shed_inventory_bags: number | null;
  closing_balance_bags: number | null;
  flagged: boolean;
  flag_reason: string | null;
  linked_flock_ids: string[];
}

// Flocks whose label is effective on the date, each with that date's
// feed_bags (if a Daily Production row exists) — lets the entry form show a
// live "linked flocks total" preview against consumed_bags before saving.
export interface ActiveFlockOption {
  flock_internal_id: string;
  display_label: string;
  feed_bags: number | null;
}

export interface FeedBagStockDay {
  groups: FeedBagGroupRow[];
  activeFlocks: ActiveFlockOption[];
  knownGroupNames: string[];
}

export async function getFeedBagStockDay(date: string): Promise<FeedBagStockDay> {
  const [groupsRes, flocksRes, namesRes] = await Promise.all([
    pool.query(
      `SELECT g.id, g.flock_group, g.opening_balance_bags, g.produced_bags,
              g.total_bags, g.consumed_bags, g.mill_inventory_bags,
              g.shed_inventory_bags, g.closing_balance_bags, g.flagged, g.flag_reason,
              coalesce(
                array_agg(l.flock_internal_id) FILTER (WHERE l.flock_internal_id IS NOT NULL),
                '{}'
              ) AS linked_flock_ids
         FROM daily_feed_bag_stock g
         LEFT JOIN daily_feed_bag_stock_flocks l ON l.feed_bag_stock_id = g.id
        WHERE g.farm_code = $1 AND g.date = $2
        GROUP BY g.id
        ORDER BY g.flock_group`,
      [ACTIVE_FARM, date]
    ),
    pool.query(
      `SELECT h.display_label, f.flock_internal_id, dp.feed_bags
         FROM flock_label_history h
         JOIN flocks f USING (flock_internal_id)
         LEFT JOIN daily_production dp
           ON dp.flock_internal_id = f.flock_internal_id AND dp.date = $2
        WHERE f.farm_code = $1
          AND h.effective_from <= $2
          AND (h.effective_to IS NULL OR h.effective_to >= $2)
        ORDER BY h.display_label`,
      [ACTIVE_FARM, date]
    ),
    pool.query(
      `SELECT DISTINCT flock_group FROM daily_feed_bag_stock
        WHERE farm_code = $1 ORDER BY flock_group`,
      [ACTIVE_FARM]
    ),
  ]);

  return {
    groups: groupsRes.rows,
    activeFlocks: flocksRes.rows,
    knownGroupNames: namesRes.rows.map((r) => r.flock_group),
  };
}
