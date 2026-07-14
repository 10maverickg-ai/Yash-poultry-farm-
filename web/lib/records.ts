import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";

// Read-only records views (increment 5): recent rows per register so the
// owner can verify what's been entered, and the flagged queue — the seed of
// Phase 3's review queue, minus photos. Queue = flagged AND not yet
// reviewed; a flag clears by fixing the data on its entry screen (re-save
// re-validates) or by "mark reviewed" for flags that reflect a real event
// rather than a data error (e.g. a genuine mortality spike).

export interface ProductionRecord {
  id: number;
  date: string;
  display_label_as_written: string | null;
  shed_code: string | null;
  mortality: number | null;
  feed_bags: number | null;
  eggs_total: number | null;
  bird_population: number | null;
  hd_percent: string | null;
  flagged: boolean;
  flag_reason: string | null;
  reviewed_by_owner: boolean;
}

export async function listProductionRecords(limit = 60): Promise<ProductionRecord[]> {
  const { rows } = await pool.query(
    `SELECT id, date, display_label_as_written, shed_code, mortality, feed_bags,
            eggs_total, bird_population, hd_percent, flagged, reviewed_by_owner,
            flag_reason
       FROM daily_production
      WHERE farm_code = $1
      ORDER BY date DESC, display_label_as_written
      LIMIT $2`,
    [ACTIVE_FARM, limit]
  );
  return rows;
}

export interface EggStockRecord {
  id: number;
  date: string;
  total_eggs_produced: number | null;
  grade_13_eggs: number | null;
  grade_14_eggs: number | null;
  grade_15_eggs: number | null;
  grade_15plus_eggs: number | null;
  closing_balance_eggs: number | null;
  closing_balance_trays: string | null;
  entry_count: number;
  flagged: boolean;
  flag_reason: string | null;
  reviewed_by_owner: boolean;
}

export async function listEggStockRecords(limit = 60): Promise<EggStockRecord[]> {
  const { rows } = await pool.query(
    `SELECT s.id, s.date, s.total_eggs_produced, s.grade_13_eggs, s.grade_14_eggs,
            s.grade_15_eggs, s.grade_15plus_eggs, s.closing_balance_eggs,
            s.closing_balance_trays, s.flagged, s.flag_reason, s.reviewed_by_owner,
            (SELECT count(*)::int FROM daily_egg_stock_entries e
              WHERE e.egg_stock_summary_id = s.id) AS entry_count
       FROM daily_egg_stock_summary s
      WHERE s.farm_code = $1
      ORDER BY s.date DESC
      LIMIT $2`,
    [ACTIVE_FARM, limit]
  );
  return rows;
}

export interface FeedStockRecord {
  id: number;
  date: string;
  material_name: string;
  opening_balance_kg: string | null;
  purchase_kg: string | null;
  consumed_kg: string | null;
  closing_balance_kg: string | null;
  flagged: boolean;
  flag_reason: string | null;
  reviewed_by_owner: boolean;
}

export async function listFeedStockRecords(limit = 90): Promise<FeedStockRecord[]> {
  const { rows } = await pool.query(
    `SELECT id, date, material_name, opening_balance_kg, purchase_kg, consumed_kg,
            closing_balance_kg, flagged, flag_reason, reviewed_by_owner
       FROM feed_stock
      WHERE farm_code = $1
      ORDER BY date DESC, material_name
      LIMIT $2`,
    [ACTIVE_FARM, limit]
  );
  return rows;
}

// --- the flagged queue -------------------------------------------------------

export type FlaggedSource = "production" | "egg_stock" | "feed_stock";

export interface FlaggedItem {
  source: FlaggedSource;
  id: number;
  date: string;
  title: string; // what the owner sees: flock label / "Egg stock" / material
  flag_reason: string | null;
  entry_href: string; // where to fix it
  source_photo_url: string | null; // set once Phase 3 extraction writes it
}

export async function listFlagged(): Promise<FlaggedItem[]> {
  const [prod, egg, feed] = await Promise.all([
    pool.query(
      `SELECT id, date, display_label_as_written AS label, flag_reason, source_photo_url
         FROM daily_production
        WHERE farm_code = $1 AND flagged AND NOT reviewed_by_owner
        ORDER BY date DESC LIMIT 100`,
      [ACTIVE_FARM]
    ),
    pool.query(
      `SELECT id, date, flag_reason, source_photo_url
         FROM daily_egg_stock_summary
        WHERE farm_code = $1 AND flagged AND NOT reviewed_by_owner
        ORDER BY date DESC LIMIT 100`,
      [ACTIVE_FARM]
    ),
    pool.query(
      `SELECT id, date, material_name, flag_reason, source_photo_url
         FROM feed_stock
        WHERE farm_code = $1 AND flagged AND NOT reviewed_by_owner
        ORDER BY date DESC LIMIT 100`,
      [ACTIVE_FARM]
    ),
  ]);

  const items: FlaggedItem[] = [
    ...prod.rows.map((r) => ({
      source: "production" as const,
      id: r.id,
      date: r.date,
      title: `Daily Production — ${r.label ?? "unknown flock"}`,
      flag_reason: r.flag_reason,
      entry_href: `/production?date=${r.date}`,
      source_photo_url: r.source_photo_url,
    })),
    ...egg.rows.map((r) => ({
      source: "egg_stock" as const,
      id: r.id,
      date: r.date,
      title: "Egg Stock Ledger",
      flag_reason: r.flag_reason,
      entry_href: `/egg-stock?date=${r.date}`,
      source_photo_url: r.source_photo_url,
    })),
    ...feed.rows.map((r) => ({
      source: "feed_stock" as const,
      id: r.id,
      date: r.date,
      title: `Feed Stock — ${r.material_name}`,
      flag_reason: r.flag_reason,
      entry_href: `/feed-stock?date=${r.date}`,
      source_photo_url: r.source_photo_url,
    })),
  ];
  return items.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}
