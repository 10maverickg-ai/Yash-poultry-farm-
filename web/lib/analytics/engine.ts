// Analytics engine: PURE functions over plain data (no DB, no framework), so
// the same code runs in the page and in scripts/analytics-check.mts against
// exported copies of the real August/September rows.
//
// Conventions (all verified against the real rows, see PR description):
//   - Flock identity is flock_internal_id. The register label
//     (display_label_as_written) shifts when a flock leaves, so it is only
//     ever shown as "the label on that day", never used to join anything.
//   - bird_population is the END-of-day count; the chain is
//       pop(D) = pop(D-1) - mortality(D) + sum(movements on D)
//   - HD% = eggs / bird_population * 100 (the stored hd_percent).
//   - "Own 7-day average" = mean of the flock's previous 7 daily rows (the
//     day itself excluded), rows within the last 14 calendar days only.
//   - Nothing here invents a figure: where a reference or input is missing
//     the result says so ("no reference loaded", null).

export interface FlockRef {
  id: string;
  label: string; // flocks.display_label (can be stale; display only as a fallback)
  breed: string | null;
  placementDate: string | null;
}

export interface ProdRow {
  id: number;
  date: string;
  flockId: string;
  label: string; // display_label_as_written: the register label that day
  mort: number | null;
  feed: number | null;
  eggs: number | null;
  pop: number | null;
  hd: number | null;
  flagged: boolean;
  reviewed: boolean;
}

export interface Movement {
  id: number;
  date: string;
  flockId: string;
  change: number;
  type: string;
  needsReview: boolean;
  reviewed: boolean;
}

export interface EggSummary {
  id: number;
  date: string;
  section: string; // 'big' | 'small'
  produced: number | null;
  opening: number | null;
  closing: number | null;
  reviewed: boolean;
}

export interface FeedBox {
  id: number;
  date: string;
  group: string;
  opening: number | null;
  produced: number | null;
  consumed: number | null;
  closing: number | null;
  reviewed: boolean;
  flockIds: string[]; // from daily_feed_bag_stock_flocks
}

export interface StdRow {
  age: number;
  hdp: number;
}

export interface EngineInput {
  flocks: FlockRef[];
  prod: ProdRow[];
  movements: Movement[];
  egg: EggSummary[];
  feedBoxes: FeedBox[];
  chick: { date: string; deaths: number }[];
  std: StdRow[]; // bv300_standard_laying (guide_version 2023)
}

// ---- tunable rules (the owner's brief, plus the few choices it left open) --
export const RULES = {
  dropPoints: 3, // production drop: >= 3 points below own 7-day average
  mortMultiple: 2, // high mortality: > 2x own 7-day average ...
  mortMinShare: 0.001, // ... and > 0.1% of the flock
  feedDaysMin: 3, // low feed stock: under 3 days
  eggDaysMax: 3, // egg build-up: over 3 days of production unsold
  birdTolerance: 2, // bird-count chain: |residual| <= 2 is register rounding
  // Choices the brief did not specify (flagged in the PR description):
  greenMinRatio: 0.9, // flock card green: 7-day HD >= 90% of the BV300 standard for its age
  amberMinRatio: 0.8, // amber: 80-90% of standard; red: under 80%
  moultFeedFraction: 0.25, // moult onset: feed <= 25% of own prior 7-day avg
  moultRecoveredFraction: 0.8, // moult over once HD back to 80% of pre-moult
  moultMaxDays: 60,
  creepRatio: 1.5, // mortality creeping: 7-day avg >= 1.5x prior 14-day avg
  creepMinDeaths: 1, // ... and at least +1 death/day
  trendWorsenPoints: 2, // trending below: gap grew >= 2 points week on week
};

export function addDays(d: string, n: number): string {
  const t = Date.parse(d + "T00:00:00Z") + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}
export function diffDays(a: string, b: string): number {
  return Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 86400000);
}
const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
const round = (x: number, p = 1) => Math.round(x * 10 ** p) / 10 ** p;
const fmt = (x: number) => Math.round(x).toLocaleString("en-IN");

export type AlertKind =
  | "production_drop"
  | "high_mortality"
  | "low_feed_stock"
  | "egg_buildup"
  | "bird_count_anomaly"
  | "feed_anomaly"
  | "missing_day";

export interface Alert {
  kind: AlertKind;
  date: string;
  flockId: string | null;
  flockLabel: string | null; // register label that day
  flockTag: string | null; // stable identity, e.g. "placed May 2025" (labels shift)
  reason: string; // plain words WITH the numbers
  // The record this alert is about, when it has a reviewed_by_owner column.
  source: { table: "production" | "feed_bag_stock"; id: number } | null;
}

export interface Ctx {
  input: EngineInput;
  flockById: Map<string, FlockRef>;
  byFlock: Map<string, ProdRow[]>; // sorted by date
  byDate: Map<string, ProdRow[]>;
  dates: string[]; // distinct production dates, sorted
  moveByFlockDate: Map<string, Movement[]>;
  eggByDate: Map<string, EggSummary[]>;
  boxByDate: Map<string, FeedBox[]>;
  stdByAge: Map<number, number>;
}

export function buildCtx(input: EngineInput): Ctx {
  const byFlock = new Map<string, ProdRow[]>();
  const byDate = new Map<string, ProdRow[]>();
  for (const r of input.prod) {
    (byFlock.get(r.flockId) ?? byFlock.set(r.flockId, []).get(r.flockId)!).push(r);
    (byDate.get(r.date) ?? byDate.set(r.date, []).get(r.date)!).push(r);
  }
  for (const rs of byFlock.values()) rs.sort((a, b) => (a.date < b.date ? -1 : 1));
  const moveByFlockDate = new Map<string, Movement[]>();
  for (const m of input.movements) {
    const k = `${m.flockId}|${m.date}`;
    (moveByFlockDate.get(k) ?? moveByFlockDate.set(k, []).get(k)!).push(m);
  }
  const eggByDate = new Map<string, EggSummary[]>();
  for (const e of input.egg) (eggByDate.get(e.date) ?? eggByDate.set(e.date, []).get(e.date)!).push(e);
  const boxByDate = new Map<string, FeedBox[]>();
  for (const b of input.feedBoxes) (boxByDate.get(b.date) ?? boxByDate.set(b.date, []).get(b.date)!).push(b);
  return {
    input,
    flockById: new Map(input.flocks.map((f) => [f.id, f])),
    byFlock,
    byDate,
    dates: [...byDate.keys()].sort(),
    moveByFlockDate,
    eggByDate,
    boxByDate,
    stdByAge: new Map(input.std.map((s) => [s.age, s.hdp])),
  };
}

// --- small lookups -----------------------------------------------------------

/** The flock's rows strictly before `date`, newest first, at most `n`, none older than 14 days. */
function priorRows(ctx: Ctx, flockId: string, date: string, n: number): ProdRow[] {
  const rs = ctx.byFlock.get(flockId) ?? [];
  const out: ProdRow[] = [];
  for (let i = rs.length - 1; i >= 0 && out.length < n; i--) {
    if (rs[i].date >= date) continue;
    if (diffDays(date, rs[i].date) > 14) break;
    out.push(rs[i]);
  }
  return out;
}
function rowOn(ctx: Ctx, flockId: string, date: string): ProdRow | undefined {
  return (ctx.byFlock.get(flockId) ?? []).find((r) => r.date === date);
}
function movesOn(ctx: Ctx, flockId: string, date: string): Movement[] {
  return ctx.moveByFlockDate.get(`${flockId}|${date}`) ?? [];
}
function labelOn(ctx: Ctx, flockId: string, date: string): string {
  const rs = ctx.byFlock.get(flockId) ?? [];
  let best: ProdRow | undefined;
  for (const r of rs) if (r.date <= date) best = r;
  return best?.label ?? ctx.flockById.get(flockId)?.label ?? "flock";
}
export function flockTag(ctx: Ctx, flockId: string): string | null {
  const p = ctx.flockById.get(flockId)?.placementDate;
  if (!p) return null;
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(p.slice(5, 7)) - 1];
  return `placed ${mon} ${p.slice(0, 4)}`;
}
export function registerLabel(ctx: Ctx, flockId: string, date: string): string {
  return labelOn(ctx, flockId, date);
}

// --- moulting (INFERRED: there is no moult table or marker in the database) --
//
// A flock is treated as moulting on date D when, within the previous
// `moultMaxDays`, its feed fell to <= 25% of its own prior 7-day average
// (feed withdrawal) AND its HD% on D is still below 80% of the HD% it had
// before that withdrawal. It stops being "moulting" once HD% is back to 80%
// of the pre-moult level. On the real data this marks BAB-5's flock (d6b2…)
// from 17 Aug to 26 Sep. If the owner records moults explicitly later, this
// function is the single place to swap in the real marker.
export interface Moult {
  startedOn: string;
  baselineHd: number;
}
export function moultOn(ctx: Ctx, flockId: string, date: string): Moult | null {
  const rs = ctx.byFlock.get(flockId) ?? [];
  const today = rs.find((r) => r.date === date);
  if (!today || today.hd == null) return null;
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i];
    if (r.date > date) break;
    if (diffDays(date, r.date) > RULES.moultMaxDays) continue;
    const prior = priorRows(ctx, flockId, r.date, 7);
    const priorFeed = mean(prior.map((p) => p.feed).filter((x): x is number => x != null));
    if (priorFeed == null || priorFeed < 5 || r.feed == null) continue;
    if (r.feed > RULES.moultFeedFraction * priorFeed) continue;
    const baseline = mean(prior.map((p) => p.hd).filter((x): x is number => x != null));
    if (baseline == null) continue;
    if (today.hd < RULES.moultRecoveredFraction * baseline) {
      return { startedOn: r.date, baselineHd: baseline };
    }
    return null; // withdrawal happened but production never collapsed / has recovered
  }
  return null;
}

/** Date of a feed-withdrawal day (feed <= 25% of own prior 7-day average) in the last 60 days, if any. */
export function recentFeedWithdrawal(ctx: Ctx, flockId: string, date: string): string | null {
  for (const r of ctx.byFlock.get(flockId) ?? []) {
    if (r.date > date || diffDays(date, r.date) > RULES.moultMaxDays) continue;
    const prior = priorRows(ctx, flockId, r.date, 7);
    const priorFeed = mean(prior.map((p) => p.feed).filter((x): x is number => x != null));
    if (priorFeed != null && priorFeed >= 5 && r.feed != null && r.feed <= RULES.moultFeedFraction * priorFeed) return r.date;
  }
  return null;
}

// --- farm today --------------------------------------------------------------

export interface DayTotals {
  date: string;
  eggs: number;
  trays: number;
  birds: number;
  hd: number | null;
  mort: number;
  feed: number;
  flocks: number;
}
export function dayTotals(ctx: Ctx, date: string): DayTotals | null {
  const rs = ctx.byDate.get(date);
  if (!rs || rs.length === 0) return null;
  const eggs = rs.reduce((s, r) => s + (r.eggs ?? 0), 0);
  const birds = rs.reduce((s, r) => s + (r.pop ?? 0), 0);
  return {
    date,
    eggs,
    trays: eggs / 30,
    birds,
    hd: birds > 0 ? (eggs / birds) * 100 : null,
    mort: rs.reduce((s, r) => s + (r.mort ?? 0), 0),
    feed: rs.reduce((s, r) => s + (r.feed ?? 0), 0),
    flocks: rs.length,
  };
}
export interface FarmToday {
  asOf: string;
  today: DayTotals | null;
  yesterday: DayTotals | null;
  avg7: { eggs: number; trays: number; hd: number | null; mort: number; feed: number; days: number } | null;
}
export function farmToday(ctx: Ctx, asOf: string): FarmToday {
  const today = dayTotals(ctx, asOf);
  const yesterday = dayTotals(ctx, addDays(asOf, -1));
  const prev: DayTotals[] = [];
  for (let i = 1; i <= 7; i++) {
    const t = dayTotals(ctx, addDays(asOf, -i));
    if (t) prev.push(t);
  }
  const avg7 = prev.length
    ? {
        eggs: mean(prev.map((p) => p.eggs))!,
        trays: mean(prev.map((p) => p.trays))!,
        hd: mean(prev.map((p) => p.hd).filter((x): x is number => x != null)),
        mort: mean(prev.map((p) => p.mort))!,
        feed: mean(prev.map((p) => p.feed))!,
        days: prev.length,
      }
    : null;
  return { asOf, today, yesterday, avg7 };
}

// --- flock cards -------------------------------------------------------------

export type CardStatus = "green" | "amber" | "red" | "moult" | "no_reference" | "left";

export interface FlockCard {
  flockId: string;
  label: string; // register label on the as-of date (or its last reporting day)
  formerLabels: string[]; // earlier register labels in the data window, oldest first
  placementDate: string | null;
  breed: string | null;
  tag: string | null;
  ageWeeks: number | null;
  status: CardStatus;
  statusNote: string; // why this colour, with the numbers
  stdHd: number | null;
  hd7: number | null; // own average over the last 7 rows
  gap: number | null; // stdHd - hd7
  birds: number | null;
  mort7: number | null; // deaths/day, last 7 rows
  feed7: number | null; // bags/day, last 7 rows
  hdSeries: number[]; // last 14 rows, for the sparkline
  lastDate: string;
}

function lastRows(ctx: Ctx, flockId: string, asOf: string, n: number): ProdRow[] {
  const rs = ctx.byFlock.get(flockId) ?? [];
  const out: ProdRow[] = [];
  for (let i = rs.length - 1; i >= 0 && out.length < n; i--) {
    if (rs[i].date > asOf) continue;
    out.push(rs[i]);
  }
  return out.reverse();
}

export function stdFor(ctx: Ctx, flock: FlockRef | undefined, asOf: string): { std: number | null; age: number | null; why: string } {
  if (!flock?.placementDate) return { std: null, age: null, why: "no reference loaded (no placement date)" };
  const age = Math.floor(diffDays(asOf, flock.placementDate) / 7);
  if ((flock.breed ?? "").toUpperCase() !== "BV300")
    return { std: null, age, why: `no reference loaded (${flock.breed ?? "unknown breed"}; only BV300 is loaded)` };
  const s = ctx.stdByAge.get(age);
  if (s == null)
    return { std: null, age, why: `no reference loaded (age ${age} wks; the BV300 table covers weeks 19–100)` };
  return { std: s, age, why: "" };
}

export function flockCards(ctx: Ctx, asOf: string): FlockCard[] {
  const cards: FlockCard[] = [];
  for (const [flockId, rs] of ctx.byFlock) {
    const upto = rs.filter((r) => r.date <= asOf);
    if (upto.length === 0) continue;
    const last = upto[upto.length - 1];
    const flock = ctx.flockById.get(flockId);
    const labels: string[] = [];
    for (const r of upto) if (labels[labels.length - 1] !== r.label) labels.push(r.label);
    const win = lastRows(ctx, flockId, asOf, 7);
    const hds = win.map((r) => r.hd).filter((x): x is number => x != null);
    const hd7 = mean(hds);
    const { std, age, why } = stdFor(ctx, flock, asOf);
    const gap = std != null && hd7 != null ? std - hd7 : null;
    const left = last.date < asOf;
    let status: CardStatus;
    let note: string;
    const moult = left ? null : moultOn(ctx, flockId, asOf);
    if (left) {
      status = "left";
      note = `Last reported ${last.date}; not on the register since.`;
    } else if (moult) {
      status = "moult";
      note = `Moulting (inferred): feed was withdrawn ${moult.startedOn}; HD ${hd7 != null ? round(hd7) : "–"}% vs ${round(moult.baselineHd)}% before.`;
    } else if (std == null) {
      status = "no_reference";
      note = why;
    } else if (gap == null) {
      status = "no_reference";
      note = "No HD% in the last 7 days.";
    } else {
      const ratio = hd7! / std;
      status = ratio >= RULES.greenMinRatio ? "green" : ratio >= RULES.amberMinRatio ? "amber" : "red";
      note = `7-day HD ${round(hd7!)}% vs BV300 standard ${round(std)}% at week ${age} (${round(ratio * 100, 0)}% of standard, ${gap > 0 ? "−" : "+"}${round(Math.abs(gap))} points).`;
      const w = recentFeedWithdrawal(ctx, flockId, asOf);
      if (w) note += ` Feed was withdrawn ${w}, so this flock is recovering from a moult; the standard assumes none.`;
    }
    cards.push({
      flockId,
      label: last.label,
      formerLabels: labels.slice(0, -1),
      placementDate: flock?.placementDate ?? null,
      breed: flock?.breed ?? null,
      tag: flockTag(ctx, flockId),
      ageWeeks: age,
      status,
      statusNote: note,
      stdHd: std,
      hd7,
      gap,
      birds: last.pop,
      mort7: mean(win.map((r) => r.mort).filter((x): x is number => x != null)),
      feed7: mean(win.map((r) => r.feed).filter((x): x is number => x != null)),
      hdSeries: lastRows(ctx, flockId, asOf, 14).map((r) => r.hd ?? 0),
      lastDate: last.date,
    });
  }
  const order: Record<CardStatus, number> = { red: 0, amber: 1, moult: 2, green: 3, no_reference: 4, left: 5 };
  return cards.sort((a, b) => order[a.status] - order[b.status] || a.label.localeCompare(b.label, undefined, { numeric: true }));
}

// --- month view --------------------------------------------------------------

export interface MonthRow {
  flockId: string | null; // null = farm total
  label: string;
  labels: string[];
  days: number;
  eggs: number;
  feed: number;
  mort: number;
  mortPct: number | null; // deaths / birds at start of the first day
  hd: number | null; // eggs / sum of daily bird counts
  note: string | null;
}
export function monthView(ctx: Ctx, month: string): { rows: MonthRow[]; total: MonthRow; chickDeaths: number } {
  const inMonth = (d: string) => d.startsWith(month);
  const rows: MonthRow[] = [];
  let popDays = 0;
  for (const [flockId, rs] of ctx.byFlock) {
    const m = rs.filter((r) => inMonth(r.date));
    if (m.length === 0) continue;
    const labels: string[] = [];
    for (const r of m) if (labels[labels.length - 1] !== r.label) labels.push(r.label);
    const eggs = m.reduce((s, r) => s + (r.eggs ?? 0), 0);
    const pops = m.reduce((s, r) => s + (r.pop ?? 0), 0);
    popDays += pops;
    const start = m[0].pop != null ? m[0].pop + (m[0].mort ?? 0) : null;
    const mort = m.reduce((s, r) => s + (r.mort ?? 0), 0);
    const lastAll = rs[rs.length - 1];
    const lastInMonth = m[m.length - 1];
    rows.push({
      flockId,
      label: labels[labels.length - 1],
      labels,
      days: m.length,
      eggs,
      feed: m.reduce((s, r) => s + (r.feed ?? 0), 0),
      mort,
      mortPct: start ? (mort / start) * 100 : null,
      hd: pops > 0 ? (eggs / pops) * 100 : null,
      note:
        lastInMonth === lastAll && lastInMonth.date < lastDayOfData(ctx)
          ? `left after ${lastInMonth.date}`
          : null,
    });
  }
  rows.sort((a, b) => b.eggs - a.eggs);
  const eggs = rows.reduce((s, r) => s + r.eggs, 0);
  const mort = rows.reduce((s, r) => s + r.mort, 0);
  const total: MonthRow = {
    flockId: null,
    label: "Farm total",
    labels: [],
    days: new Set(ctx.dates.filter(inMonth)).size,
    eggs,
    feed: rows.reduce((s, r) => s + r.feed, 0),
    mort,
    mortPct: null,
    hd: popDays > 0 ? (eggs / popDays) * 100 : null,
    note: null,
  };
  const chickDeaths = ctx.input.chick.filter((c) => inMonth(c.date)).reduce((s, c) => s + c.deaths, 0);
  return { rows, total, chickDeaths };
}
export function lastDayOfData(ctx: Ctx): string {
  return ctx.dates[ctx.dates.length - 1];
}

// --- alerts ------------------------------------------------------------------

function boxTotals(ctx: Ctx, date: string) {
  const bs = ctx.boxByDate.get(date) ?? [];
  if (bs.length === 0) return null;
  return {
    closing: bs.reduce((s, b) => s + (b.closing ?? 0), 0),
    consumed: bs.reduce((s, b) => s + (b.consumed ?? 0), 0),
  };
}

/** Closing feed bags / average daily consumption over the last 7 dates with a box row. */
export function feedDaysLeft(ctx: Ctx, date: string): { days: number; closing: number; perDay: number } | null {
  const t = boxTotals(ctx, date);
  if (!t) return null;
  const cons: number[] = [];
  for (let i = 0; i < 7; i++) {
    const x = boxTotals(ctx, addDays(date, -i));
    if (x && x.consumed > 0) cons.push(x.consumed);
  }
  const perDay = mean(cons);
  if (!perDay) return null;
  return { days: t.closing / perDay, closing: t.closing, perDay };
}

/** Closing egg stock (all sections recorded that day) / average daily eggs laid over the last 7 days. */
export function eggStockDays(ctx: Ctx, date: string): { days: number; closing: number; perDay: number; sections: number } | null {
  const es = ctx.eggByDate.get(date) ?? [];
  if (es.length === 0) return null;
  const laid: number[] = [];
  for (let i = 0; i < 7; i++) {
    const t = dayTotals(ctx, addDays(date, -i));
    if (t) laid.push(t.eggs);
  }
  const perDay = mean(laid);
  if (!perDay) return null;
  const closing = es.reduce((s, e) => s + (e.closing ?? 0), 0);
  return { days: closing / perDay, closing, perDay, sections: es.length };
}

export function alertsFor(ctx: Ctx, date: string): Alert[] {
  const out: Alert[] = [];
  const rows = ctx.byDate.get(date) ?? [];

  for (const r of rows) {
    const lbl = r.label;
    const base = { date, flockId: r.flockId, flockLabel: lbl, flockTag: flockTag(ctx, r.flockId), source: { table: "production" as const, id: r.id } };
    const prior = priorRows(ctx, r.flockId, date, 7);
    const moult = moultOn(ctx, r.flockId, date);

    // production drop
    if (r.hd != null && !r.reviewed && !moult) {
      const avg = mean(prior.map((p) => p.hd).filter((x): x is number => x != null));
      if (avg != null && prior.length >= 4 && avg - r.hd >= RULES.dropPoints) {
        const mv = movesOn(ctx, r.flockId, date).reduce((s, m) => s + m.change, 0);
        out.push({
          ...base,
          kind: "production_drop",
          reason: `HD ${round(r.hd)}% vs its own 7-day average ${round(avg)}% (−${round(avg - r.hd)} points, ${fmt(r.eggs ?? 0)} eggs${mv ? `; bird count also moved ${mv > 0 ? "+" : "−"}${fmt(Math.abs(mv))} that day` : ""}).`,
        });
      }
    }

    // high mortality
    if (r.mort != null && r.pop != null && !r.reviewed) {
      const avg = mean(prior.map((p) => p.mort).filter((x): x is number => x != null));
      const flockSize = r.pop + r.mort;
      if (avg != null && prior.length >= 4 && r.mort > RULES.mortMultiple * avg && r.mort > RULES.mortMinShare * flockSize) {
        out.push({
          ...base,
          kind: "high_mortality",
          reason: `${r.mort} deaths vs its own 7-day average ${round(avg)}/day (${round(r.mort / Math.max(avg, 0.01), 1)}×) and ${round((r.mort / flockSize) * 100, 2)}% of ${fmt(flockSize)} birds.`,
        });
      }
    }

    // feed anomaly (a): zero feed with live birds, not moulting
    if (r.feed === 0 && (r.pop ?? 0) > 0 && !moult && !r.reviewed) {
      out.push({
        ...base,
        kind: "feed_anomaly",
        reason: `0 feed bags recorded for ${fmt(r.pop!)} live birds (own 7-day average ${round(mean(prior.map((p) => p.feed).filter((x): x is number => x != null)) ?? 0)} bags/day), and the flock is not moulting.`,
      });
    }

    // bird-count anomaly: change beyond mortality with no movement record
    const prev = prior[0];
    if (prev && diffDays(date, prev.date) === 1 && r.pop != null && prev.pop != null && r.mort != null && !r.reviewed) {
      const mv = movesOn(ctx, r.flockId, date);
      const moved = mv.reduce((s, m) => s + m.change, 0);
      const residual = r.pop - (prev.pop - r.mort) - moved;
      if (Math.abs(residual) > RULES.birdTolerance) {
        out.push({
          ...base,
          kind: "bird_count_anomaly",
          reason:
            mv.length === 0
              ? `Bird count went ${fmt(prev.pop)} → ${fmt(r.pop)} (${residual > 0 ? "+" : "−"}${fmt(Math.abs(residual))} more than the ${r.mort} deaths explain) with no movement record.`
              : `Bird count ${fmt(prev.pop)} → ${fmt(r.pop)}; the recorded movement (${moved > 0 ? "+" : "−"}${fmt(Math.abs(moved))}) and ${r.mort} deaths still leave ${residual > 0 ? "+" : "−"}${fmt(Math.abs(residual))} unexplained.`,
        });
      }
    }
  }

  // feed anomaly (b): feed box consumed vs sum of the flock rows it covers
  for (const b of ctx.boxByDate.get(date) ?? []) {
    if (b.reviewed || b.consumed == null) continue;
    const sum = b.flockIds.reduce((s, id) => s + (rowOn(ctx, id, date)?.feed ?? 0), 0);
    if (b.flockIds.length > 0 && sum !== b.consumed) {
      out.push({
        kind: "feed_anomaly",
        date,
        flockId: null,
        flockLabel: null,
        flockTag: null,
        source: { table: "feed_bag_stock", id: b.id },
        reason: `Feed box "${b.group}" consumed ${b.consumed} bags but its ${b.flockIds.length} flock rows add up to ${sum} (${b.consumed - sum > 0 ? "+" : "−"}${Math.abs(b.consumed - sum)}).`,
      });
    }
  }

  // low feed stock
  const fd = feedDaysLeft(ctx, date);
  if (fd && fd.days < RULES.feedDaysMin) {
    out.push({
      kind: "low_feed_stock",
      date,
      flockId: null,
      flockLabel: null,
      flockTag: null,
      source: null,
      reason: `${fmt(fd.closing)} bags in stock at ${round(fd.perDay)} bags/day = ${round(fd.days)} days (alert under ${RULES.feedDaysMin}).`,
    });
  }

  // egg stock build-up
  const es = eggStockDays(ctx, date);
  if (es && es.days > RULES.eggDaysMax && !(ctx.eggByDate.get(date) ?? []).every((e) => e.reviewed)) {
    out.push({
      kind: "egg_buildup",
      date,
      flockId: null,
      flockLabel: null,
      flockTag: null,
      source: null,
      reason: `${fmt(es.closing)} eggs (${fmt(es.closing / 30)} trays) in stock vs ${fmt(es.perDay)} laid/day = ${round(es.days)} days unsold (alert over ${RULES.eggDaysMax})${es.sections < 2 ? "; only one ledger section was recorded that day" : ""}.`,
    });
  }

  // missing day
  const first = ctx.dates[0];
  if (first && date > first) {
    const hasAny = rows.length > 0;
    if (!hasAny) {
      out.push({ kind: "missing_day", date, flockId: null, flockLabel: null, flockTag: null, source: null, reason: `No Daily Production rows at all for ${date}.` });
    } else {
      const prevDate = addDays(date, -1);
      for (const p of ctx.byDate.get(prevDate) ?? []) {
        if (rowOn(ctx, p.flockId, date)) continue;
        const gone = (p.pop ?? 0) + movesOn(ctx, p.flockId, date).reduce((s, m) => s + m.change, 0) <= RULES.birdTolerance * 2;
        if (gone) continue; // the flock left: that is a movement, not a missed day
        out.push({
          kind: "missing_day",
          date,
          flockId: p.flockId,
          flockLabel: p.label,
          flockTag: flockTag(ctx, p.flockId),
          source: null,
          reason: `${p.label} reported ${fmt(p.pop ?? 0)} birds on ${prevDate} but has no row on ${date} and no movement record says it left.`,
        });
      }
      const eggs = ctx.eggByDate.get(date) ?? [];
      const usual = Math.max(0, ...[...ctx.eggByDate.values()].map((x) => x.length));
      if (eggs.length < usual) {
        out.push({
          kind: "missing_day",
          date,
          flockId: null,
          flockLabel: null,
          flockTag: null,
          source: null,
          reason: `Egg stock ledger has ${eggs.length} of ${usual} sections for ${date}${eggs[0] ? ` (only "${eggs[0].section}")` : " (none)"}.`,
        });
      }
      if (!(ctx.boxByDate.get(date) ?? []).length && ctx.boxByDate.size > 0) {
        out.push({ kind: "missing_day", date, flockId: null, flockLabel: null, flockTag: null, source: null, reason: `No feed bag box row for ${date}.` });
      }
    }
  }
  return out;
}

// --- "what can go wrong next" -------------------------------------------------

export interface WatchItem {
  kind: "trending_below" | "feed_days" | "mortality_creeping";
  flockId: string | null;
  label: string | null;
  text: string;
}

export function watchList(ctx: Ctx, asOf: string): WatchItem[] {
  const items: WatchItem[] = [];
  for (const c of flockCards(ctx, asOf)) {
    if (c.status === "left" || c.status === "moult") continue;
    const rs = lastRows(ctx, c.flockId, asOf, 14);
    // trending below standard: the gap to standard grew week on week
    if (c.stdHd != null && rs.length >= 10) {
      const recent = mean(rs.slice(-7).map((r) => r.hd).filter((x): x is number => x != null));
      const before = mean(rs.slice(0, rs.length - 7).map((r) => r.hd).filter((x): x is number => x != null));
      if (recent != null && before != null) {
        const worsen = before - recent;
        if (worsen >= RULES.trendWorsenPoints && c.stdHd - recent > 3) {
          items.push({
            kind: "trending_below",
            flockId: c.flockId,
            label: c.label,
            text: `${c.label}: HD ${round(before)}% → ${round(recent)}% week on week, now ${round(c.stdHd - recent)} points under the ${round(c.stdHd)}% standard.`,
          });
        }
      }
    }
    // mortality creeping: last 7 days vs the 14 before
    const all = lastRows(ctx, c.flockId, asOf, 21);
    if (all.length >= 14) {
      const last7 = mean(all.slice(-7).map((r) => r.mort ?? 0))!;
      const prior = mean(all.slice(0, all.length - 7).map((r) => r.mort ?? 0))!;
      if (prior > 0 && last7 >= RULES.creepRatio * prior && last7 - prior >= RULES.creepMinDeaths) {
        items.push({
          kind: "mortality_creeping",
          flockId: c.flockId,
          label: c.label,
          text: `${c.label}: deaths ${round(prior)}/day → ${round(last7)}/day (last 7 days vs the 14 before).`,
        });
      }
    }
  }
  const fd = feedDaysLeft(ctx, asOf);
  if (fd) {
    items.push({
      kind: "feed_days",
      flockId: null,
      label: null,
      text: `Feed: ${fmt(fd.closing)} bags = ${round(fd.days)} days at ${round(fd.perDay)} bags/day — runs out about ${addDays(asOf, Math.floor(fd.days))} without a delivery.`,
    });
  }
  return items;
}
