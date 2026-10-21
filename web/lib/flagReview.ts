import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import type { DateFilter } from "@/lib/records";

// Everything open on /flagged, regrouped by DAY for the review screen. Read
// only: each item names the one existing action that clears it (all of them
// set a reviewed_by_owner flag or resolve one flock_movements row — no new
// column, no schema change).
//
// Flock identity is flock_internal_id. The label shown is the REGISTER label
// that day (daily_production.display_label_as_written), because
// flocks.display_label is a single current value and register labels shift
// when a flock leaves. A short "placed Mon YYYY" tag tells flocks apart when
// the same label belongs to different flocks on different days.

export interface FlockChoice {
  id: string;
  label: string; // register label on that day
  tag: string | null;
}

export type ReviewItem =
  | {
      kind: "production";
      id: number;
      date: string;
      label: string;
      tag: string | null;
      focus: "feed" | "eggs" | "mortality" | "birds" | null;
      cells: { feed: number | null; eggs: number | null; mortality: number | null; birds: number | null; hd: string | null };
      reason: string;
    }
  | {
      kind: "ledger_gap";
      id: number; // daily_egg_stock_summary.id of the day whose opening is off
      date: string;
      section: string;
      opening: number;
      previousClosing: number;
    }
  | {
      kind: "egg_entry";
      id: number;
      date: string;
      label: string;
      category: string;
      amount: number | null;
      reason: string;
    }
  | {
      kind: "movement";
      id: number;
      date: string;
      label: string;
      tag: string | null;
      change: number;
      before: number | null;
      after: number | null;
      note: string | null;
      type: string;
      others: FlockChoice[];
    }
  | { kind: "page_issue"; id: number; date: string; text: string };

export interface ReviewDay {
  date: string;
  items: ReviewItem[];
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const tagOf = (p: string | null) => (p ? `placed ${MON[Number(p.slice(5, 7)) - 1]} ${p.slice(0, 4)}` : null);

function focusOf(reason: string): "feed" | "eggs" | "mortality" | "birds" | null {
  if (/feed/i.test(reason)) return "feed";
  if (/egg/i.test(reason)) return "eggs";
  if (/mortal|death/i.test(reason)) return "mortality";
  if (/bird|bal/i.test(reason)) return "birds";
  return null;
}

export async function loadFlagReview(filter: DateFilter = {}): Promise<{ days: ReviewDay[]; otherOpen: { unresolved: number; ledgerIssues: number } }> {
  const from = filter.from ?? null;
  const to = filter.to ?? null;
  const [prod, movements, entries, summaries, pageIssues, flocks, unresolved, ledgerIssues] = await Promise.all([
    pool.query(
      `SELECT id, date, flock_internal_id, display_label_as_written AS label, mortality,
              feed_bags, eggs_total, bird_population, hd_percent, flag_reason
         FROM daily_production
        WHERE farm_code = $1 AND flagged AND NOT reviewed_by_owner AND deleted_at IS NULL
          AND ($2::date IS NULL OR date >= $2) AND ($3::date IS NULL OR date <= $3)`,
      [ACTIVE_FARM, from, to]
    ),
    pool.query(
      `SELECT id, date, flock_internal_id, birds_change, movement_type, register_note
         FROM flock_movements
        WHERE farm_code = $1 AND needs_review AND NOT reviewed_by_owner
          AND ($2::date IS NULL OR date >= $2) AND ($3::date IS NULL OR date <= $3)`,
      [ACTIVE_FARM, from, to]
    ),
    pool.query(
      `SELECT e.id, s.date, e.label_as_written, e.category, e.amount_eggs, e.flag_reason
         FROM daily_egg_stock_entries e
         JOIN daily_egg_stock_summary s ON s.id = e.egg_stock_summary_id
        WHERE s.farm_code = $1 AND s.deleted_at IS NULL AND e.flagged AND NOT e.reviewed_by_owner
          AND ($2::date IS NULL OR s.date >= $2) AND ($3::date IS NULL OR s.date <= $3)`,
      [ACTIVE_FARM, from, to]
    ),
    pool.query(
      `SELECT id, date, section, opening_balance_eggs, closing_balance_eggs, reviewed_by_owner
         FROM daily_egg_stock_summary
        WHERE farm_code = $1 AND deleted_at IS NULL`,
      [ACTIVE_FARM]
    ),
    pool.query(
      `SELECT id, date, issue_text FROM daily_production_page_issues
        WHERE farm_code = $1 AND NOT reviewed_by_owner AND deleted_at IS NULL
          AND ($2::date IS NULL OR date >= $2) AND ($3::date IS NULL OR date <= $3)`,
      [ACTIVE_FARM, from, to]
    ),
    pool.query(`SELECT flock_internal_id, placement_date FROM flocks WHERE farm_code = $1`, [ACTIVE_FARM]),
    pool.query(
      `SELECT count(*)::int AS n FROM unresolved_extractions
        WHERE farm_code = $1 AND resolved_at IS NULL AND deleted_at IS NULL`,
      [ACTIVE_FARM]
    ),
    pool.query(
      `SELECT count(*)::int AS n FROM ledger_extraction_issues
        WHERE farm_code = $1 AND NOT reviewed_by_owner AND deleted_at IS NULL`,
      [ACTIVE_FARM]
    ),
  ]);

  const placement = new Map<string, string | null>(
    flocks.rows.map((f) => [f.flock_internal_id, f.placement_date ? String(f.placement_date).slice(0, 10) : null])
  );
  const tag = (flockId: string) => tagOf(placement.get(flockId) ?? null);

  // Register label + bird counts for the movement rows' flocks.
  const flockIds = [...new Set(movements.rows.map((m) => m.flock_internal_id))];
  const history = flockIds.length
    ? await pool.query(
        `SELECT flock_internal_id, date, display_label_as_written AS label, bird_population
           FROM daily_production
          WHERE farm_code = $1 AND deleted_at IS NULL AND flock_internal_id = ANY($2::uuid[])
          ORDER BY date`,
        [ACTIVE_FARM, flockIds]
      )
    : { rows: [] as { flock_internal_id: string; date: string; label: string; bird_population: number | null }[] };

  const movementDates = [...new Set(movements.rows.map((m) => m.date))];
  const dayRows = movementDates.length
    ? await pool.query(
        `SELECT date, flock_internal_id, display_label_as_written AS label
           FROM daily_production
          WHERE farm_code = $1 AND deleted_at IS NULL AND date = ANY($2::date[])
          ORDER BY display_label_as_written`,
        [ACTIVE_FARM, movementDates]
      )
    : { rows: [] as { date: string; flock_internal_id: string; label: string }[] };

  const byDay = new Map<string, ReviewItem[]>();
  const push = (date: string, item: ReviewItem) => (byDay.get(date) ?? byDay.set(date, []).get(date)!).push(item);

  for (const r of prod.rows) {
    const reason: string = r.flag_reason ?? "flagged";
    push(r.date, {
      kind: "production",
      id: Number(r.id),
      date: r.date,
      label: r.label ?? "unknown flock",
      tag: tag(r.flock_internal_id),
      focus: focusOf(reason),
      cells: { feed: r.feed_bags, eggs: r.eggs_total, mortality: r.mortality, birds: r.bird_population, hd: r.hd_percent },
      reason,
    });
  }

  for (const m of movements.rows) {
    const rows = history.rows.filter((h) => h.flock_internal_id === m.flock_internal_id);
    const onDay = rows.find((h) => h.date === m.date);
    const before = [...rows].reverse().find((h) => h.date < m.date);
    const lastKnown = onDay ?? before;
    push(m.date, {
      kind: "movement",
      id: Number(m.id),
      date: m.date,
      label: lastKnown?.label ?? "flock",
      tag: tag(m.flock_internal_id),
      change: m.birds_change,
      before: before?.bird_population ?? null,
      after: onDay ? onDay.bird_population : null, // null = no row that day (flock gone)
      note: m.register_note,
      type: m.movement_type,
      others: dayRows.rows
        .filter((d) => d.date === m.date && d.flock_internal_id !== m.flock_internal_id)
        .map((d) => ({ id: d.flock_internal_id, label: d.label, tag: tag(d.flock_internal_id) })),
    });
  }

  for (const e of entries.rows) {
    push(e.date, {
      kind: "egg_entry",
      id: Number(e.id),
      date: e.date,
      label: e.label_as_written ?? "(no label)",
      category: String(e.category),
      amount: e.amount_eggs,
      reason: e.flag_reason ?? "flagged",
    });
  }

  // Egg ledger: a day's opening balance must equal the previous day's closing
  // balance, per section. (Not a stored flag today; derived here so it can be
  // answered like any other.) Only gaps between consecutive days count.
  const sums = summaries.rows;
  const key = (d: string, s: string) => `${d}|${s}`;
  const idx = new Map(sums.map((s) => [key(s.date, s.section ?? ""), s]));
  for (const s of sums) {
    if (s.reviewed_by_owner || s.opening_balance_eggs == null) continue;
    if ((from && s.date < from) || (to && s.date > to)) continue;
    const d = new Date(Date.parse(s.date + "T00:00:00Z") - 86400000).toISOString().slice(0, 10);
    const prev = idx.get(key(d, s.section ?? ""));
    if (!prev || prev.closing_balance_eggs == null) continue;
    if (prev.closing_balance_eggs !== s.opening_balance_eggs) {
      push(s.date, {
        kind: "ledger_gap",
        id: Number(s.id),
        date: s.date,
        section: s.section ?? "",
        opening: s.opening_balance_eggs,
        previousClosing: prev.closing_balance_eggs,
      });
    }
  }

  for (const p of pageIssues.rows) push(p.date, { kind: "page_issue", id: Number(p.id), date: p.date, text: p.issue_text });

  const order = { production: 0, movement: 1, ledger_gap: 2, egg_entry: 3, page_issue: 4 } as const;
  const days: ReviewDay[] = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, items]) => ({
      date,
      items: items.sort((a, b) => order[a.kind] - order[b.kind] || a.id - b.id),
    }));

  return { days, otherOpen: { unresolved: unresolved.rows[0].n, ledgerIssues: ledgerIssues.rows[0].n } };
}
