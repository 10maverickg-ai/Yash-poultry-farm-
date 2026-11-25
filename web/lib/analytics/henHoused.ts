// V17 (owner, 25 Nov 2026): hen-housed production, the breeder's definition. PURE.
//   eggs per hen housed = all eggs the flock laid since it was housed ÷ the number of hens housed
//   hen-housed %        = eggs ÷ (hens housed × days) × 100   (hen-day % divides by the birds alive each day instead;
//                         hen-housed never goes up when birds die, so deaths and sales pull it down)
// The number of hens housed (a fixed number per flock) comes from, in this order:
//   1. the owner, when he gives it (OWNER_HENS_HOUSED below; no database change);
//   2. the register: a flock whose first row is inside the data (BAB-9, 10, 11, housed about 1 Oct 2026, first
//      row 4 Oct) was counted on its first day: birds at the start of that day = count + deaths − moves;
//   3. a STAND-IN: for a flock that was already laying when the data starts (2 Jul 2026), the birds at the start of
//      that first day. It is always labelled as a stand-in, and it is never compared with the breeder's book
//      (the eggs before that day are not in the app, and the book counts from housing).
// Birds MOVED in or out after housing (transfers between flocks, to or from Anil farm, unexplained moves, count
// corrections) change the number of hens housed from that day on; deaths, culls and sales do NOT (they are the
// losses hen-housed is meant to show). With a changing number, eggs per hen housed adds up each day's eggs ÷ that
// day's hens housed (the same as all eggs ÷ hens housed when nothing was moved).
// The breeder's figures (BV300 "current HH", eggs per hen housed per week of age) give the book's eggs per hen
// housed over exactly the same days: the sum of (eggs per hen housed that week ÷ 7) over the flock's days.
import { breedKey, diffDays, isPlaceholderAge, type Ctx } from "./engine";

/** Hens housed given by the owner, by flock id (the flock's name in the comment). Empty until he sends them. */
export const OWNER_HENS_HOUSED: Record<string, { count: number; date: string }> = {};

export type HousedSource = "owner" | "register" | "standin";

export interface HensHoused {
  flockId: string;
  count: number;
  date: string; // counted at the start of this day; eggs are summed from this day on
  source: HousedSource;
  note: string; // plain words: where the number comes from
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dmy = (d: string) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;

/** The number of hens housed for a flock, with where it comes from; null when the flock has no rows. */
export function hensHoused(ctx: Ctx, flockId: string): HensHoused | null {
  const own = OWNER_HENS_HOUSED[flockId];
  if (own) return { flockId, count: own.count, date: own.date, source: "owner", note: `${own.count.toLocaleString("en-IN")} hens housed on ${dmy(own.date)}, as given by the owner` };
  const rows = ctx.byFlock.get(flockId) ?? [];
  const first = rows[0];
  if (!first || first.pop == null) return null;
  const moves = (ctx.moveByFlockDate.get(`${flockId}|${first.date}`) ?? []).reduce((s, m) => s + m.change, 0);
  const count = first.pop + (first.mort ?? 0) - moves;
  if (count <= 0) return null;
  const fromStart = first.date <= ctx.dates[0];
  return fromStart
    ? { flockId, count, date: first.date, source: "standin", note: `stand-in: ${count.toLocaleString("en-IN")} birds at the start of ${dmy(first.date)}, the first day in the app; the number housed is not known` }
    : { flockId, count, date: first.date, source: "register", note: `${count.toLocaleString("en-IN")} hens housed: the birds at the start of the flock's first day in the register (${dmy(first.date)})` };
}

/** Movement types that move birds between flocks or farms (they change the hens housed); deaths, culls and sales do not. */
export const HOUSED_MOVES = new Set(["transfer_in", "transfer_out", "unexplained_in", "unexplained_out", "count_adjustment"]);

/** Hens housed on a day: the housed count plus the birds moved in or out (transfers) since the housed day, up to that day. */
export function housedOn(ctx: Ctx, h: HensHoused, date: string): number {
  let n = h.count;
  for (const m of ctx.input.movements) if (m.flockId === h.flockId && HOUSED_MOVES.has(m.type) && m.date >= h.date && m.date <= date) n += m.change;
  return n;
}

/** The breeder's eggs per hen housed for one flock-day (BV300 "current HH" of that week ÷ 7), or null. */
function bookPerDay(ctx: Ctx, flockId: string, date: string): number | null {
  const f = ctx.flockById.get(flockId);
  if (!f?.placementDate || isPlaceholderAge(f) || breedKey(f.breed) !== "BV300") return null;
  const week = Math.floor(diffDays(date, f.placementDate) / 7);
  const row = ctx.input.std.find((s) => s.age === week);
  return row?.hhWeek != null ? row.hhWeek / 7 : null;
}

export interface HenHousedResult {
  housed: HensHoused;
  from: string; // the housed date
  to: string; // last day counted
  days: number; // days with rows from the housed date to `to`
  eggs: number;
  perHen: number; // eggs per hen housed: the sum of each day's eggs ÷ that day's hens housed
  henDays: number; // the sum of each day's hens housed (the hen-housed % denominator)
  movedDays: number; // days on which birds moved in or out had changed the number housed
  hhPct: number | null; // eggs ÷ (hens housed × days) × 100
  hdPct: number | null; // the same rows' hen-day % (eggs ÷ bird-days), for contrast
  book: { perHen: number | null; hhPct: number | null; why: string | null }; // breeder's figures over the same days
}

/** Hen-housed figures of one flock over its rows from `from` (default: the housed date) to `to` (inclusive). */
export function henHousedFor(ctx: Ctx, flockId: string, to: string, from?: string): HenHousedResult | null {
  const housed = hensHoused(ctx, flockId);
  if (!housed) return null;
  const start = from && from > housed.date ? from : housed.date;
  const rows = (ctx.byFlock.get(flockId) ?? []).filter((r) => r.date >= start && r.date <= to);
  if (rows.length === 0) return null;
  const eggs = rows.reduce((s, r) => s + (r.eggs ?? 0), 0);
  const birdDays = rows.reduce((s, r) => s + (r.pop ?? 0), 0);
  // each day's eggs ÷ that day's hens housed (transfers adjust the number; deaths, culls and sales do not)
  let perHen = 0;
  let henDays = 0;
  let moved = 0;
  for (const r of rows) {
    const n = housedOn(ctx, housed, r.date);
    if (n > 0) { perHen += (r.eggs ?? 0) / n; henDays += n; }
    if (n !== housed.count) moved++;
  }
  let why: string | null = null;
  let bookEggs = 0;
  if (housed.source === "standin") why = "the number housed is not known (stand-in), so it is not compared with the book";
  else {
    for (const r of rows) {
      const b = bookPerDay(ctx, flockId, r.date);
      if (b == null) { why = "no breeder's hen-housed figure for this flock's age or breed"; break; }
      bookEggs += b;
    }
  }
  return {
    housed,
    from: start,
    to: rows[rows.length - 1].date,
    days: rows.length,
    eggs,
    perHen,
    hhPct: henDays > 0 ? (eggs / henDays) * 100 : null,
    henDays,
    movedDays: moved,
    hdPct: birdDays > 0 ? (eggs / birdDays) * 100 : null,
    book: why ? { perHen: null, hhPct: null, why } : { perHen: bookEggs, hhPct: (bookEggs / rows.length) * 100, why: null },
  };
}

/** One flock on the board: since housing (cumulative) and over its last 7 rows. */
export function flockHenHoused(ctx: Ctx, flockId: string, asOf: string): { since: HenHousedResult; last7: HenHousedResult | null } | null {
  const since = henHousedFor(ctx, flockId, asOf);
  if (!since) return null;
  const rows = (ctx.byFlock.get(flockId) ?? []).filter((r) => r.date >= since.from && r.date <= asOf);
  const from7 = rows[Math.max(0, rows.length - 7)]?.date;
  return { since, last7: from7 ? henHousedFor(ctx, flockId, asOf, from7) : null };
}

/** A group (or chosen flocks) over a period: all their eggs ÷ (each flock's hens housed × its days with rows). */
export function groupHenHoused(ctx: Ctx, flockIds: string[], from: string, to: string): { hhPct: number | null; eggs: number; henDays: number; standins: string[]; flocks: number } {
  let eggs = 0;
  let henDays = 0;
  const standins: string[] = [];
  let flocks = 0;
  for (const id of flockIds) {
    const r = henHousedFor(ctx, id, to, from);
    if (!r) continue;
    flocks++;
    eggs += r.eggs;
    henDays += r.henDays;
    if (r.housed.source === "standin") standins.push(ctx.flockById.get(id)?.label ?? id);
  }
  return { hhPct: henDays > 0 ? (eggs / henDays) * 100 : null, eggs, henDays, standins, flocks };
}
