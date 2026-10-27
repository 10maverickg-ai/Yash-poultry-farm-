import fs from "node:fs";
import type { Pool } from "pg";
import { getActiveLabels, normalizeFlockLabel, type ActiveLabel } from "../flockMatch";
import type { EggStockSection } from "../../eggstock-types";

// Where the benchmark reads the SAVED values it scores against. Two
// sources, same shape: the live database (the admin page, on a deployment
// that has DATABASE_URL) and a plain JSON export (the offline runner —
// scripts/run-reader-benchmark-offline.ts — which is how this benchmark is
// run locally without ever being handed database credentials: the saved
// rows are exported once through the read-only Supabase connector into
// benchmark-data/*.json).

export interface DbProductionRow {
  display_label_as_written: string;
  flock_internal_id: string;
  mortality: number | null;
  feed_bags: number | null;
  eggs_total: number | null;
  bird_population: number | null;
  // numeric(5,2) — node-postgres returns this as a string, never a number,
  // since no custom type parser is registered for it (lib/db.ts only
  // parses DATE). Must go through Number() before any comparison.
  hd_percent_written: string | number | null;
  flagged: boolean;
  flag_reason: string | null;
  source_photo_url: string | null;
}

export interface SavedLedgerRow {
  id: number;
  section: EggStockSection;
  opening_balance_eggs: number | null;
  total_eggs_produced: number | null;
  total_line_eggs: number | null;
  closing_balance_eggs: number | null;
  deductions: { sequence_order: number; label_as_written: string; amount_eggs: number }[];
}

export interface SavedFeedRow {
  flock_group: string;
  opening_balance_bags: number | null;
  produced_bags: number | null;
  total_bags: number | null;
  closing_balance_bags: number | null;
  consumed_bags: number | null;
  mill_inventory_bags: number | null;
  shed_inventory_bags: number | null;
}

export interface SavedChickRow {
  label_as_written: string;
  deaths: number | null;
}

// What the previous CALENDAR day saved — context for the day-to-day chain
// and opening-balance checks. Empty/null when that day isn't saved.
export interface PreviousDayContext {
  birdByLabel: Map<string, number> | null;
  ledgerClosing: Partial<Record<EggStockSection, number | null>>;
  feedClosing: Record<string, number | null>;
}

export interface SavedDataSource {
  production(date: string): Promise<DbProductionRow[]>;
  photoUrl(date: string): Promise<string | null>;
  activeLabels(date: string): Promise<ActiveLabel[]>;
  movementMagnitudes(date: string): Promise<Map<string, number>>;
  ledgers(date: string): Promise<SavedLedgerRow[]>;
  // Latest saved closing BEFORE this date (any earlier day) — the existing
  // cross-day note.
  previousLedgerClosing(section: EggStockSection, date: string): Promise<number | null>;
  feed(date: string): Promise<SavedFeedRow[]>;
  chick(date: string): Promise<SavedChickRow[]>;
  previousDay(date: string): Promise<PreviousDayContext>;
}

function dayBefore(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function dbSavedData(pool: Pool, farmCode: string): SavedDataSource {
  return {
    async production(date) {
      const { rows } = await pool.query(
        `SELECT display_label_as_written, flock_internal_id, mortality, feed_bags, eggs_total,
                bird_population, hd_percent_written, flagged, flag_reason, source_photo_url
           FROM daily_production
          WHERE farm_code = $1 AND date = $2 AND deleted_at IS NULL`,
        [farmCode, date]
      );
      return rows as DbProductionRow[];
    },
    async photoUrl(date) {
      const { rows } = await pool.query(
        `SELECT source_photo_url FROM daily_production
          WHERE farm_code = $1 AND date = $2 AND deleted_at IS NULL AND source_photo_url IS NOT NULL
          LIMIT 1`,
        [farmCode, date]
      );
      if (rows[0]?.source_photo_url) return rows[0].source_photo_url as string;
      const { rows: bench } = await pool.query(
        `SELECT photo_url FROM reader_benchmark_photos WHERE farm_code = $1 AND date = $2`,
        [farmCode, date]
      );
      return (bench[0]?.photo_url as string | undefined) ?? null;
    },
    activeLabels: (date) => getActiveLabels(pool, farmCode, date),
    async movementMagnitudes(date) {
      const { rows } = await pool.query(
        `SELECT flock_internal_id, sum(abs(birds_change))::int AS total_magnitude
           FROM flock_movements
          WHERE farm_code = $1 AND date = $2
          GROUP BY flock_internal_id`,
        [farmCode, date]
      );
      return new Map<string, number>(rows.map((r) => [r.flock_internal_id as string, Number(r.total_magnitude)]));
    },
    async ledgers(date) {
      const { rows } = await pool.query(
        `SELECT id, section, opening_balance_eggs, total_eggs_produced, total_line_eggs, closing_balance_eggs
           FROM daily_egg_stock_summary
          WHERE farm_code = $1 AND date = $2 AND deleted_at IS NULL`,
        [farmCode, date]
      );
      const bySummary = new Map<number, SavedLedgerRow["deductions"]>();
      if (rows.length > 0) {
        const { rows: ded } = await pool.query(
          `SELECT egg_stock_summary_id, sequence_order, label_as_written, amount_eggs
             FROM daily_egg_stock_entries
            WHERE egg_stock_summary_id = ANY($1)
            ORDER BY egg_stock_summary_id, sequence_order`,
          [rows.map((r) => r.id)]
        );
        for (const d of ded) {
          const list = bySummary.get(d.egg_stock_summary_id) ?? [];
          list.push(d);
          bySummary.set(d.egg_stock_summary_id, list);
        }
      }
      return rows.map((r) => ({ ...(r as Omit<SavedLedgerRow, "deductions">), deductions: bySummary.get(r.id) ?? [] }));
    },
    async previousLedgerClosing(section, date) {
      const { rows } = await pool.query(
        `SELECT closing_balance_eggs FROM daily_egg_stock_summary
          WHERE farm_code = $1 AND section = $2 AND date < $3 AND deleted_at IS NULL
          ORDER BY date DESC LIMIT 1`,
        [farmCode, section, date]
      );
      return rows[0]?.closing_balance_eggs ?? null;
    },
    async feed(date) {
      const { rows } = await pool.query(
        `SELECT flock_group, opening_balance_bags, produced_bags, total_bags, closing_balance_bags,
                consumed_bags, mill_inventory_bags, shed_inventory_bags
           FROM daily_feed_bag_stock
          WHERE farm_code = $1 AND date = $2 AND deleted_at IS NULL`,
        [farmCode, date]
      );
      return rows as SavedFeedRow[];
    },
    async chick(date) {
      const { rows } = await pool.query(
        `SELECT label_as_written, deaths FROM chick_daily_mortality WHERE farm_code = $1 AND date = $2 ORDER BY row_position`,
        [farmCode, date]
      );
      return rows as SavedChickRow[];
    },
    async previousDay(date) {
      const prev = dayBefore(date);
      const { rows: prod } = await pool.query(
        `SELECT display_label_as_written AS label, bird_population FROM daily_production
          WHERE farm_code = $1 AND date = $2 AND deleted_at IS NULL`,
        [farmCode, prev]
      );
      const { rows: led } = await pool.query(
        `SELECT section, closing_balance_eggs FROM daily_egg_stock_summary
          WHERE farm_code = $1 AND date = $2 AND deleted_at IS NULL`,
        [farmCode, prev]
      );
      const { rows: feed } = await pool.query(
        `SELECT flock_group, closing_balance_bags FROM daily_feed_bag_stock
          WHERE farm_code = $1 AND date = $2 AND deleted_at IS NULL`,
        [farmCode, prev]
      );
      return {
        birdByLabel: prod.length > 0 ? new Map(prod.filter((r) => r.bird_population !== null).map((r) => [normalizeFlockLabel(r.label), Number(r.bird_population)])) : null,
        ledgerClosing: Object.fromEntries(led.map((r) => [r.section, r.closing_balance_eggs])),
        feedClosing: Object.fromEntries(feed.map((r) => [r.flock_group, r.closing_balance_bags])),
      };
    },
  };
}

interface SavedJson {
  photos?: Record<string, string>;
  production: (DbProductionRow & { date: string })[];
  ledgers: (Omit<SavedLedgerRow, "id" | "deductions"> & { date: string; deductions: { seq: number; label: string; amount: number }[] })[];
  feed: (SavedFeedRow & { date: string })[];
  chick: (SavedChickRow & { date: string })[];
  movements: { date: string; flock_internal_id: string; total_magnitude: number }[];
  labels: { display_label: string; flock_internal_id: string }[];
  context: {
    production: { date: string; label: string; bird_population: number | null }[];
    ledger_closing: { date: string; section: EggStockSection; closing_balance_eggs: number | null }[];
    feed_closing: { date: string; flock_group: string; closing_balance_bags: number | null }[];
  };
}

export function jsonSavedData(file: string): SavedDataSource {
  const j = JSON.parse(fs.readFileSync(file, "utf8")) as SavedJson;
  return {
    async production(date) {
      return j.production.filter((r) => r.date === date);
    },
    async photoUrl(date) {
      return j.photos?.[date] ?? null;
    },
    async activeLabels() {
      return j.labels.map((l) => ({ displayLabel: l.display_label, flockInternalId: l.flock_internal_id }));
    },
    async movementMagnitudes(date) {
      return new Map(j.movements.filter((m) => m.date === date).map((m) => [m.flock_internal_id, m.total_magnitude]));
    },
    async ledgers(date) {
      return j.ledgers
        .filter((l) => l.date === date)
        .map((l, i) => ({
          id: i + 1,
          section: l.section,
          opening_balance_eggs: l.opening_balance_eggs,
          total_eggs_produced: l.total_eggs_produced,
          total_line_eggs: l.total_line_eggs,
          closing_balance_eggs: l.closing_balance_eggs,
          deductions: l.deductions.map((d) => ({ sequence_order: d.seq, label_as_written: d.label, amount_eggs: d.amount })),
        }));
    },
    async previousLedgerClosing(section, date) {
      const earlier = j.context.ledger_closing.filter((c) => c.section === section && c.date < date).sort((a, b) => (a.date < b.date ? 1 : -1));
      return earlier[0]?.closing_balance_eggs ?? null;
    },
    async feed(date) {
      return j.feed.filter((f) => f.date === date);
    },
    async chick(date) {
      return j.chick.filter((c) => c.date === date);
    },
    async previousDay(date) {
      const prev = dayBefore(date);
      const prod = j.context.production.filter((p) => p.date === prev && p.bird_population !== null);
      return {
        birdByLabel: prod.length > 0 ? new Map(prod.map((p) => [normalizeFlockLabel(p.label), p.bird_population as number])) : null,
        ledgerClosing: Object.fromEntries(j.context.ledger_closing.filter((c) => c.date === prev).map((c) => [c.section, c.closing_balance_eggs])),
        feedClosing: Object.fromEntries(j.context.feed_closing.filter((c) => c.date === prev).map((c) => [c.flock_group, c.closing_balance_bags])),
      };
    },
  };
}
