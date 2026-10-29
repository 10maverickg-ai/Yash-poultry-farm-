import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { compareLabels } from "@/lib/naturalSort";
import { rateFor } from "@/lib/rates/lookup";
import type { AnswerKey, ManualDay } from "./manualDay";

// What the "Enter a day by hand" screen starts with: yesterday's figures (so birds, opening stocks and the register layout are filled in),
// and, when the day is already saved, what was saved (so it can be corrected and saved over).
export interface ManualContext {
  date: string;
  prevDate: string | null;
  saved: boolean; // the day already has production rows
  savedBy: string | null; // 'manual entry' | 'reader or older entry'
  rate: { per100: number | null; effective: number; carried: boolean; rateDate: string } | null;
  day: ManualDay;
  movements: string[]; // plain sentences about bird movements already recorded on the date
}

const D = (v: unknown) => String(v).slice(0, 10);
const n = (v: unknown): number | null => (v == null ? null : Number(v));

function answerFor(category: string | null, signed: number): AnswerKey {
  switch (category) {
    case "sale": return "sale";
    case "local_sale": return "local_sale";
    case "breakage": return "breakage";
    case "labour_take": return "labour_take";
    case "gift": return "gift";
    case "production_addition": return "late";
    case "cross_farm_adjustment": return signed >= 0 ? "anil_in" : "anil_out";
    default: return signed >= 0 ? "other_in" : "other_out";
  }
}

export async function loadManualContext(date: string): Promise<ManualContext> {
  const [fl, prevD] = await Promise.all([
    pool.query(`SELECT flock_internal_id, display_label, segment FROM flocks WHERE farm_code = $1 AND (status = 'active' OR depletion_date >= $2::date) ORDER BY display_label`, [ACTIVE_FARM, date]),
    pool.query(`SELECT max(date) AS d FROM daily_production WHERE farm_code = $1 AND deleted_at IS NULL AND date < $2::date`, [ACTIVE_FARM, date]),
  ]);
  const prevDate: string | null = prevD.rows[0]?.d ? D(prevD.rows[0].d) : null;
  const [prevRows, thisRows, moves, prevFeed, thisFeed, prevLed, thisLed, chick, rate] = await Promise.all([
    prevDate ? pool.query(`SELECT flock_internal_id, bird_population FROM daily_production WHERE farm_code = $1 AND date = $2 AND deleted_at IS NULL`, [ACTIVE_FARM, prevDate]) : Promise.resolve({ rows: [] as Record<string, unknown>[] }),
    pool.query(`SELECT flock_internal_id, mortality, feed_bags, eggs_total, bird_population, source_tag FROM daily_production WHERE farm_code = $1 AND date = $2 AND deleted_at IS NULL`, [ACTIVE_FARM, date]),
    pool.query(`SELECT m.flock_internal_id, m.birds_change, m.movement_type, f.display_label FROM flock_movements m JOIN flocks f USING (flock_internal_id) WHERE m.farm_code = $1 AND m.date = $2`, [ACTIVE_FARM, date]),
    pool.query(`SELECT closing_balance_bags FROM daily_feed_bag_stock WHERE farm_code = $1 AND flock_group = 'ALL' AND date < $2::date AND deleted_at IS NULL ORDER BY date DESC LIMIT 1`, [ACTIVE_FARM, date]),
    pool.query(`SELECT opening_balance_bags, produced_bags, mill_inventory_bags, shed_inventory_bags, source_tag FROM daily_feed_bag_stock WHERE farm_code = $1 AND flock_group = 'ALL' AND date = $2 AND deleted_at IS NULL`, [ACTIVE_FARM, date]),
    pool.query(`SELECT DISTINCT ON (section) section, closing_balance_eggs FROM daily_egg_stock_summary WHERE farm_code = $1 AND date < $2::date AND deleted_at IS NULL ORDER BY section, date DESC`, [ACTIVE_FARM, date]),
    pool.query(`SELECT s.id, s.section, s.opening_balance_eggs, s.closing_balance_eggs, s.source_tag FROM daily_egg_stock_summary s WHERE s.farm_code = $1 AND s.date = $2 AND s.deleted_at IS NULL`, [ACTIVE_FARM, date]),
    pool.query(`SELECT row_position, label_as_written, deaths FROM chick_daily_mortality WHERE farm_code = $1 AND date = $2 ORDER BY row_position`, [ACTIVE_FARM, date]),
    rateFor(pool, date),
  ]);
  const prevPop = new Map(prevRows.rows.map((r) => [r.flock_internal_id as string, n(r.bird_population)]));
  const mine = new Map(thisRows.rows.map((r) => [r.flock_internal_id as string, r]));
  const moved = new Map<string, number>();
  for (const m of moves.rows) moved.set(m.flock_internal_id as string, (moved.get(m.flock_internal_id as string) ?? 0) + Number(m.birds_change));
  const flocks = fl.rows
    .map((f) => ({ flockId: f.flock_internal_id as string, label: f.display_label as string, group: (f.segment === "young" ? "young" : "main") as "young" | "main" }))
    .sort((a, b) => (a.group === b.group ? compareLabels(a.label, b.label) : a.group === "main" ? -1 : 1))
    .map((f) => {
      const r = mine.get(f.flockId);
      return { ...f, prevBirds: prevPop.get(f.flockId) ?? null, moved: moved.get(f.flockId) ?? 0, mortality: r ? n(r.mortality) : null, feed: r ? n(r.feed_bags) : null, eggs: r ? n(r.eggs_total) : null, birds: r ? n(r.bird_population) : null };
    });
  const closingOf = (sec: string) => n(prevLed.rows.find((r) => r.section === sec)?.closing_balance_eggs);
  const ledgerDay = async (sec: "big" | "small") => {
    const s = thisLed.rows.find((r) => r.section === sec);
    const lines = s
      ? (await pool.query(`SELECT label_as_written, category, amount_eggs FROM daily_egg_stock_entries WHERE egg_stock_summary_id = $1 ORDER BY sequence_order`, [s.id])).rows.map((e) => ({ answer: answerFor(e.category, Number(e.amount_eggs)), eggs: Math.abs(Number(e.amount_eggs)), label: String(e.label_as_written) }))
      : [];
    return { prevClosing: closingOf(sec), opening: s ? n(s.opening_balance_eggs) : closingOf(sec), closing: s ? n(s.closing_balance_eggs) : null, lines };
  };
  const [big, small] = await Promise.all([ledgerDay("big"), ledgerDay("small")]);
  const fb = thisFeed.rows[0];
  const prevFeedClosing = n(prevFeed.rows[0]?.closing_balance_bags);
  const saved = thisRows.rows.length > 0;
  const srcs = [...thisRows.rows.map((r) => r.source_tag as string | null)];
  const day: ManualDay = {
    date,
    flocks,
    pages: { rightDeaths: null, rightFeed: null, rightEggs: null, leftDeaths: null, leftEggs: null },
    feed: { prevClosing: prevFeedClosing, opening: fb ? n(fb.opening_balance_bags) : prevFeedClosing, produced: fb ? n(fb.produced_bags) : null, mill: fb ? n(fb.mill_inventory_bags) : null, shed: fb ? n(fb.shed_inventory_bags) : null },
    big,
    small,
    chick: chick.rows.length ? chick.rows.map((c) => ({ label: String(c.label_as_written), deaths: Number(c.deaths) })) : [{ label: "Chicks I", deaths: null }, { label: "Chicks II", deaths: null }],
  };
  return {
    date,
    prevDate,
    saved,
    savedBy: saved ? (srcs.every((s) => s === "manual entry") ? "manual entry" : "reader or an older entry") : null,
    rate: rate ? { per100: null, effective: rate.rate, carried: rate.carried, rateDate: rate.rateDate } : null,
    day,
    movements: moves.rows.map((m) => `${m.display_label}: ${Number(m.birds_change) > 0 ? "+" : "−"}${Math.abs(Number(m.birds_change))} birds (${String(m.movement_type).replaceAll("_", " ")}) already recorded`),
  };
}
