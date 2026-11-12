// V15 Compare: two INDEPENDENT calls of the period engine (summarizeRange), one per column, side by side.
// PURE (no DB, no framework). Each column is one flock (or all flocks) with its own from..to; with
// "align by flock age" each column is one flock over the same weeks of age instead of the same dates.
// Difference = B minus A. A metric that has no "better" direction (days, ages, bird counts) gets no colour.
import { addDays, diffDays, isPlaceholderAge, moultOn, stdFor, type Ctx } from "./engine";
import { customRange, makeRange, rangeCoverage, summarizeRange, type PeriodExtras, type PeriodRange, type PeriodSummary } from "./period";
import { defaultRange, flockOptions, one, resolveFlock, type Param } from "./rangeParams";
import type { CostInput } from "../costs/engine";

export interface CompareSide {
  key: "a" | "b";
  flockId: string | null; // null = all flocks
  flockLabel: string; // real name, or "All flocks"
  range: PeriodRange;
  notes: string[];
}

export interface CompareState {
  a: CompareSide;
  b: CompareSide;
  age: boolean; // align by flock age
  weeks: { from: number; to: number } | null; // the weeks of age (age mode)
  notes: string[]; // about the whole comparison
}

const isIso = (d: string | undefined): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + "T00:00:00Z").toISOString().slice(0, 10) === d;

/** The same day `n` calendar months later (negative = earlier); the day is clamped at the month end (31 Oct − 1 month = 30 Sep). */
export function addMonths(d: string, n: number): string {
  const t = Number(d.slice(0, 4)) * 12 + Number(d.slice(5, 7)) - 1 + n;
  const y = Math.floor(t / 12);
  const m = (t % 12) + 1;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return `${y}-${String(m).padStart(2, "0")}-${String(Math.min(Number(d.slice(8, 10)), last)).padStart(2, "0")}`;
}

/** Age from the placement date (the same age the breeder's book is read at everywhere in the app). */
export function ageOn(ctx: Ctx, flockId: string, date: string): { days: number; weeks: number } | null {
  const f = ctx.flockById.get(flockId);
  if (!f?.placementDate || isPlaceholderAge(f)) return null;
  const days = diffDays(date, f.placementDate);
  return { days, weeks: Math.floor(days / 7) };
}

export function ageWhy(ctx: Ctx, flockId: string | null): string {
  if (!flockId) return "mixed ages (all flocks)";
  const f = ctx.flockById.get(flockId);
  if (!f?.placementDate) return "placement date not set";
  if (isPlaceholderAge(f)) return "placement date is a placeholder";
  return "";
}

/** The weeks of age a flock has daily rows for (null = age unknown or no rows). */
export function dataWeeks(ctx: Ctx, flockId: string): { from: number; to: number } | null {
  const rs = ctx.byFlock.get(flockId) ?? [];
  if (rs.length === 0) return null;
  const a = ageOn(ctx, flockId, rs[0].date);
  const b = ageOn(ctx, flockId, rs[rs.length - 1].date);
  return a && b ? { from: Math.max(0, a.weeks), to: b.weeks } : null;
}

/** The dates of weeks `wf`..`wt` of age (inclusive) for a flock: week w = days 7w..7w+6 after placement. */
export function weeksToRange(ctx: Ctx, flockId: string, wf: number, wt: number): PeriodRange | null {
  const f = ctx.flockById.get(flockId);
  if (!f?.placementDate || isPlaceholderAge(f)) return null;
  return makeRange(addDays(f.placementDate, wf * 7), addDays(f.placementDate, wt * 7 + 6));
}

// ---- reading the address ------------------------------------------------------
//   ?a=BAB-3&af=2026-09-01&at=2026-09-15&b=BAB-5&bf=2026-10-01&bt=2026-10-15&age=0   (age=1&wf=25&wt=30 to align by age)
type SP = { a?: Param; af?: Param; at?: Param; b?: Param; bf?: Param; bt?: Param; age?: Param; wf?: Param; wt?: Param };

function sideFlock(ctx: Ctx, token: string | undefined, notes: string[]): { id: string | null; given: boolean } {
  if (!token || token.toLowerCase() === "all") return { id: null, given: !!token };
  const id = resolveFlock(ctx, token);
  if (!id) notes.push(`No flock is called "${token}", so this column shows all flocks.`);
  return { id, given: true };
}

export function readCompare(ctx: Ctx, sp: SP, today: string): CompareState {
  const notes: string[] = [];
  const opts = flockOptions(ctx);
  const live = opts.filter((o) => !o.gone);
  const aNotes: string[] = [];
  const bNotes: string[] = [];
  const aTok = one(sp.a);
  const bTok = one(sp.b);
  let a = sideFlock(ctx, aTok, aNotes);
  if (!a.given) a = { id: live[0]?.id ?? null, given: false }; // nothing chosen yet: the first main flock
  let b = sideFlock(ctx, bTok, bNotes);
  if (!b.given) {
    // B not chosen: another flock of the same group (or the next one)
    const aSeg = opts.find((o) => o.id === a.id)?.segment ?? null;
    const pick = live.find((o) => o.id !== a.id && o.segment === aSeg) ?? live.find((o) => o.id !== a.id);
    b = { id: pick?.id ?? null, given: false };
  }
  const age = one(sp.age) === "1";
  const label = (id: string | null) => (id ? (ctx.flockById.get(id)?.label ?? id) : "All flocks");

  const dates = (f: string | undefined, t: string | undefined, fallback: PeriodRange, ns: string[]): PeriodRange => {
    if (!isIso(f) && !isIso(t)) return fallback;
    const r = customRange(isIso(f) ? f : t!, isIso(t) ? t : f!, { today });
    ns.push(...r.notes);
    return r.range;
  };

  let weeks: CompareState["weeks"] = null;
  let aRange: PeriodRange;
  let bRange: PeriodRange;
  if (age) {
    const n = (p: Param) => { const v = Number(one(p)); return Number.isInteger(v) && v >= 0 && v <= 200 ? v : null; };
    let wf = n(sp.wf);
    let wt = n(sp.wt);
    const spanA = a.id ? dataWeeks(ctx, a.id) : null;
    const spanB = b.id ? dataWeeks(ctx, b.id) : null;
    const common = spanA && spanB && Math.max(spanA.from, spanB.from) <= Math.min(spanA.to, spanB.to) ? { from: Math.max(spanA.from, spanB.from), to: Math.min(spanA.to, spanB.to) } : null;
    if (wf == null && wt == null) {
      // default: the last 6 weeks of age that BOTH flocks have data for (else the last 6 weeks A has data for)
      const span = common ?? spanA;
      wt = span ? span.to : 30;
      wf = Math.max(span ? span.from : 0, wt - 5);
    }
    wf ??= wt!;
    wt ??= wf;
    if (wf > wt) {
      [wf, wt] = [wt, wf];
      notes.push(`The first week was after the last week, so the two were swapped.`);
    }
    if (wt - wf + 1 > 52) {
      wf = wt - 51;
      notes.push("At most 52 weeks of age can be compared, so it starts at week " + wf + ".");
    }
    weeks = { from: wf, to: wt };
    const lbl = (id: string | null) => (id ? (ctx.flockById.get(id)?.label ?? id) : "");
    if (spanA && (wf < spanA.from || wt > spanA.to)) aNotes.push(`${lbl(a.id)} has daily rows for weeks ${spanA.from}–${spanA.to} of age only.`);
    if (spanB && (wf < spanB.from || wt > spanB.to)) bNotes.push(`${lbl(b.id)} has daily rows for weeks ${spanB.from}–${spanB.to} of age only.`);
    if (spanA && spanB && a.id !== b.id) notes.push(common ? `Weeks of age both flocks have data for: ${common.from}–${common.to}.` : `${lbl(a.id)} and ${lbl(b.id)} have no week of age in common in the data (weeks ${spanA.from}–${spanA.to} and ${spanB.from}–${spanB.to}).`);
    const aw = a.id ? weeksToRange(ctx, a.id, wf, wt) : null;
    const bw = b.id ? weeksToRange(ctx, b.id, wf, wt) : null;
    if (!aw) aNotes.push(`Align by age needs one flock with a real placement date (${ageWhy(ctx, a.id)}), so this column uses the dates instead.`);
    if (!bw) bNotes.push(`Align by age needs one flock with a real placement date (${ageWhy(ctx, b.id)}), so this column uses the dates instead.`);
    const dflt = defaultRange(ctx, today);
    aRange = aw ?? dates(one(sp.af), one(sp.at), dflt, aNotes);
    bRange = bw ?? dates(one(sp.bf), one(sp.bt), aRange, bNotes);
  } else {
    const dflt = defaultRange(ctx, today);
    aRange = dates(one(sp.af), one(sp.at), dflt, aNotes);
    bRange = dates(one(sp.bf), one(sp.bt), aRange, bNotes);
  }
  return {
    a: { key: "a", flockId: a.id, flockLabel: label(a.id), range: aRange, notes: aNotes },
    b: { key: "b", flockId: b.id, flockLabel: label(b.id), range: bRange, notes: bNotes },
    age,
    weeks,
    notes,
  };
}

/** The address of a comparison (flock names, not ids, so it can be read and bookmarked). */
export function compareHref(st: { a: Pick<CompareSide, "flockId" | "flockLabel" | "range">; b: Pick<CompareSide, "flockId" | "flockLabel" | "range">; age: boolean; weeks: CompareState["weeks"] }): string {
  const q = new URLSearchParams();
  q.set("a", st.a.flockId ? st.a.flockLabel : "all");
  q.set("af", st.a.range.from);
  q.set("at", st.a.range.to);
  q.set("b", st.b.flockId ? st.b.flockLabel : "all");
  q.set("bf", st.b.range.from);
  q.set("bt", st.b.range.to);
  q.set("age", st.age ? "1" : "0");
  if (st.age && st.weeks) {
    q.set("wf", String(st.weeks.from));
    q.set("wt", String(st.weeks.to));
  }
  return `/analytics/compare?${q.toString()}`;
}

/** The three quick set-ups. They only rewrite the address; every number is still worked out by the engine. */
export function presets(ctx: Ctx, st: CompareState): { key: string; label: string; href: string; on: boolean }[] {
  const opts = flockOptions(ctx).filter((o) => !o.gone);
  const label = (id: string | null) => (id ? (ctx.flockById.get(id)?.label ?? id) : "All flocks");
  const other = st.b.flockId && st.b.flockId !== st.a.flockId ? st.b.flockId : (opts.find((o) => o.id !== st.a.flockId)?.id ?? null);
  const a = st.a.range;
  const before = makeRange(addDays(a.from, -a.days), addDays(a.from, -1));
  const monthEarlier = makeRange(addMonths(a.from, -1), addMonths(a.to, -1));
  const sameFlock = st.a.flockId === st.b.flockId;
  const sameDates = st.a.range.from === st.b.range.from && st.a.range.to === st.b.range.to;
  return [
    {
      key: "same",
      label: "Same flock, two periods",
      on: !st.age && sameFlock && !sameDates,
      // A = the days just before, B = the chosen days: B − A is the change over time
      href: compareHref({ a: { flockId: st.a.flockId, flockLabel: st.a.flockLabel, range: before }, b: { flockId: st.a.flockId, flockLabel: st.a.flockLabel, range: a }, age: false, weeks: null }),
    },
    {
      key: "flocks-same",
      label: "Two flocks, same dates",
      on: !st.age && !sameFlock && sameDates,
      href: compareHref({ a: st.a, b: { flockId: other, flockLabel: label(other), range: a }, age: false, weeks: null }),
    },
    {
      key: "flocks-diff",
      label: "Two flocks, different dates",
      on: !st.age && !sameFlock && !sameDates,
      // A one month earlier, B on the chosen dates (e.g. BAB-3 in September against BAB-5 in October)
      href: compareHref({ a: { flockId: st.a.flockId, flockLabel: st.a.flockLabel, range: monthEarlier }, b: { flockId: other, flockLabel: label(other), range: a }, age: false, weeks: null }),
    },
  ];
}

// ---- the numbers of one column --------------------------------------------------
export interface SideResult {
  side: CompareSide;
  s: PeriodSummary;
  coverageNote: string | null;
  ageStart: { days: number; weeks: number } | null;
  ageEnd: { days: number; weeks: number } | null;
  ageWhy: string;
  book: { hd: number | null; ourHdSameDays: number | null; gap: number | null; days: number; moultDays: number; why: string };
}

/** One column: one engine call for that flock (or all flocks) and those dates, plus the age and the book standard over the same rows. */
export function compareSide(ctx: Ctx, cost: CostInput, extras: PeriodExtras, side: CompareSide): SideResult {
  const s = summarizeRange(ctx, cost, extras, side.range, { flocks: side.flockId ? [side.flockId] : null });
  const cov = rangeCoverage(ctx, side.range);
  const id = side.flockId;
  const ageStart = id && s.firstDate ? ageOn(ctx, id, s.firstDate) : null;
  const ageEnd = id && s.lastDate ? ageOn(ctx, id, s.lastDate) : null;
  // breeder's standard for the flock's age and breed, over the SAME rows (weighted by birds, like the pooled HD %)
  let book: SideResult["book"] = { hd: null, ourHdSameDays: null, gap: null, days: 0, moultDays: 0, why: id ? "" : "mixed ages: one standard does not fit all flocks; see each flock" };
  if (id) {
    const flock = ctx.flockById.get(id);
    const rows = (ctx.byFlock.get(id) ?? []).filter((r) => r.date >= side.range.from && r.date <= side.range.to && (r.pop ?? 0) > 0);
    let w = 0;
    let stdW = 0;
    let eggs = 0;
    let days = 0;
    let moultDays = 0;
    let why = "";
    for (const r of rows) {
      if (moultOn(ctx, id, r.date)) moultDays++;
      const st = stdFor(ctx, flock, r.date);
      if (st.std == null) {
        why ||= st.why;
        continue;
      }
      days++;
      w += r.pop!;
      stdW += st.std * r.pop!;
      eggs += r.eggs ?? 0;
    }
    const hd = w > 0 ? stdW / w : null;
    const our = w > 0 ? (eggs / w) * 100 : null;
    book = { hd, ourHdSameDays: our, gap: hd != null && our != null ? hd - our : null, days, moultDays, why: rows.length === 0 ? "no rows in this range" : days === 0 ? why : days < rows.length ? `book target known for ${days} of ${rows.length} days` : "" };
  }
  return { side, s, coverageNote: cov.note, ageStart, ageEnd, ageWhy: ageWhy(ctx, id), book };
}

// ---- the table: one row per measure -----------------------------------------------
export type Fmt = "int" | "num1" | "num2" | "pct1" | "pct2" | "inr" | "inr2" | "date" | "age" | "text";
export interface CompareRow {
  key: string;
  group: string;
  label: string;
  fmt: Fmt;
  a: number | string | null;
  b: number | string | null;
  /** Why a value is blank, per side (e.g. "not split by flock", "feed not recorded"). */
  aNote?: string;
  bNote?: string;
  diff: number | null; // B − A
  diffPct: number | null;
  /** true = B is better, false = B is worse, null = no better/worse for this measure (or no change / not comparable). */
  good: boolean | null;
  direction: "higher" | "lower" | "none"; // which way is better
  note?: string; // shown under the row
}

export function compareRows(A: SideResult, B: SideResult): CompareRow[] {
  const rows: CompareRow[] = [];
  const sameDays = A.s.daysWithData === B.s.daysWithData;
  const add = (r: Omit<CompareRow, "diff" | "diffPct" | "good"> & { totals?: boolean }) => {
    const { totals, ...row } = r;
    const num = typeof row.a === "number" && typeof row.b === "number";
    const diff = num && row.fmt !== "date" && row.fmt !== "text" ? (row.b as number) - (row.a as number) : null;
    const diffPct = diff != null && (row.a as number) !== 0 ? (diff / Math.abs(row.a as number)) * 100 : null;
    let good: boolean | null = null;
    if (diff != null && Math.abs(diff) > 1e-9 && row.direction !== "none" && !(totals && !sameDays)) good = row.direction === "higher" ? diff > 0 : diff < 0;
    rows.push({ ...row, diff, diffPct, good, note: row.note ?? (totals && !sameDays && diff != null ? "Totals over a different number of days with data: compare the per-day rows instead." : undefined) });
  };
  const farm = (x: SideResult) => x.s.farmLevel;
  const NS = "not split by flock";

  // dates
  add({ key: "from", group: "Dates", label: "From", fmt: "date", a: A.side.range.from, b: B.side.range.from, direction: "none" });
  add({ key: "to", group: "Dates", label: "To", fmt: "date", a: A.side.range.to, b: B.side.range.to, direction: "none" });
  add({ key: "days", group: "Dates", label: "Days in range", fmt: "int", a: A.side.range.days, b: B.side.range.days, direction: "none" });
  add({ key: "daysData", group: "Dates", label: "Days with data", fmt: "int", a: A.s.daysWithData, b: B.s.daysWithData, direction: "none" });

  // eggs
  add({ key: "eggs", group: "Eggs", label: "Eggs (total)", fmt: "int", a: A.s.eggs.total, b: B.s.eggs.total, direction: "higher", totals: true });
  add({ key: "trays", group: "Eggs", label: "Trays (total)", fmt: "num1", a: A.s.eggs.trays, b: B.s.eggs.trays, direction: "higher", totals: true });
  add({ key: "eggsDay", group: "Eggs", label: "Eggs per day", fmt: "int", a: A.s.eggs.perDay, b: B.s.eggs.perDay, direction: "higher" });
  add({ key: "hd", group: "Eggs", label: "HD % (all eggs ÷ all bird-days)", fmt: "pct1", a: A.s.eggs.hdPooled, b: B.s.eggs.hdPooled, direction: "higher" });
  add({ key: "book", group: "Eggs", label: "Breeder's standard HD % for the age and breed", fmt: "pct1", a: A.book.hd, b: B.book.hd, aNote: A.book.hd == null ? A.book.why : undefined, bNote: B.book.hd == null ? B.book.why : undefined, direction: "none", note: A.book.moultDays || B.book.moultDays ? `Moulting days in the range: A ${A.book.moultDays}, B ${B.book.moultDays}. The book assumes no moult.` : undefined });
  add({ key: "gap", group: "Eggs", label: "Points below the standard (same days)", fmt: "num1", a: A.book.gap, b: B.book.gap, direction: "lower" });
  add({ key: "peak", group: "Eggs", label: "Best day HD %", fmt: "pct1", a: A.s.eggs.best?.hd ?? null, b: B.s.eggs.best?.hd ?? null, direction: "higher" });
  add({ key: "peakDay", group: "Eggs", label: "Best day", fmt: "date", a: A.s.eggs.best?.date ?? null, b: B.s.eggs.best?.date ?? null, direction: "none" });

  // age
  add({ key: "ageStart", group: "Age", label: "Age at start (from placement)", fmt: "age", a: A.ageStart?.days ?? null, b: B.ageStart?.days ?? null, aNote: A.ageStart ? undefined : A.ageWhy || "no data", bNote: B.ageStart ? undefined : B.ageWhy || "no data", direction: "none" });
  add({ key: "ageEnd", group: "Age", label: "Age at end", fmt: "age", a: A.ageEnd?.days ?? null, b: B.ageEnd?.days ?? null, aNote: A.ageEnd ? undefined : A.ageWhy || "no data", bNote: B.ageEnd ? undefined : B.ageWhy || "no data", direction: "none" });

  // birds
  add({ key: "birdsStart", group: "Birds", label: "Birds at start", fmt: "int", a: A.s.birds.opening, b: B.s.birds.opening, direction: "none" });
  add({ key: "birdsEnd", group: "Birds", label: "Birds at end (last day with data)", fmt: "int", a: A.s.birds.closing, b: B.s.birds.closing, direction: "none" });
  add({ key: "deaths", group: "Birds", label: "Deaths (total)", fmt: "int", a: A.s.birds.deaths, b: B.s.birds.deaths, direction: "lower", totals: true });
  add({ key: "deathsPct", group: "Birds", label: "Deaths % of birds at start", fmt: "pct2", a: A.s.birds.deathsPct, b: B.s.birds.deathsPct, direction: "lower" });
  add({ key: "deaths1000", group: "Birds", label: "Deaths per 1,000 birds", fmt: "num1", a: A.s.birds.deathsPer1000, b: B.s.birds.deathsPer1000, direction: "lower" });
  const perDay1000 = (x: SideResult) => (x.s.birds.deathsPer1000 != null && x.s.daysWithData ? x.s.birds.deathsPer1000 / x.s.daysWithData : null);
  add({ key: "deaths1000day", group: "Birds", label: "Deaths per 1,000 birds per day", fmt: "num2", a: perDay1000(A), b: perDay1000(B), direction: "lower" });

  // feed
  const fed = (x: SideResult) => x.s.feed.recorded;
  const FN = "feed not recorded (left page)";
  add({ key: "feedBags", group: "Feed", label: "Feed (bags, total)", fmt: "int", a: fed(A) ? A.s.feed.bags : null, b: fed(B) ? B.s.feed.bags : null, aNote: fed(A) ? undefined : FN, bNote: fed(B) ? undefined : FN, direction: "none", totals: true });
  add({ key: "feedG", group: "Feed", label: "Feed g / bird / day", fmt: "int", a: A.s.feed.gPerBirdDay, b: B.s.feed.gPerBirdDay, aNote: fed(A) ? undefined : FN, bNote: fed(B) ? undefined : FN, direction: "none", note: "More or less feed per bird is not good or bad on its own (moult, age, season); read it with the eggs." });
  add({ key: "feed100", group: "Feed", label: "Feed kg per 100 eggs", fmt: "num1", a: A.s.feed.kgPer100Eggs, b: B.s.feed.kgPer100Eggs, aNote: fed(A) ? undefined : FN, bNote: fed(B) ? undefined : FN, direction: "lower" });

  // egg ledger (farm-level)
  add({ key: "breakPct", group: "Egg ledger", label: "Breakage, % of eggs laid", fmt: "pct2", a: farm(A) ? A.s.eggs.breakagePct : null, b: farm(B) ? B.s.eggs.breakagePct : null, aNote: farm(A) ? undefined : NS, bNote: farm(B) ? undefined : NS, direction: "lower" });
  add({ key: "otherPct", group: "Egg ledger", label: "Labour take, gifts and other, % of eggs", fmt: "pct2", a: farm(A) ? A.s.eggs.otherOutPct : null, b: farm(B) ? B.s.eggs.otherOutPct : null, aNote: farm(A) ? undefined : NS, bNote: farm(B) ? undefined : NS, direction: "lower" });

  // money (farm-level)
  const rpe = (x: SideResult) => (farm(x) ? x.s.money.revenuePerEgg : null);
  const profit = (x: SideResult) => (farm(x) ? x.s.money.profit : null);
  const profitDay = (x: SideResult) => (farm(x) && x.s.money.profit != null && x.s.daysWithData ? x.s.money.profit / x.s.daysWithData : null);
  const mNote = (x: SideResult) => (!farm(x) ? NS : x.s.money.revenue === 0 ? "no priced sales" : undefined);
  add({ key: "rpe", group: "Money (estimate)", label: "Revenue per egg sold", fmt: "inr2", a: rpe(A), b: rpe(B), aNote: rpe(A) == null ? mNote(A) ?? "some sales have no rate" : undefined, bNote: rpe(B) == null ? mNote(B) ?? "some sales have no rate" : undefined, direction: "higher" });
  add({ key: "profit", group: "Money (estimate)", label: "Estimated profit (total)", fmt: "inr", a: profit(A), b: profit(B), aNote: profit(A) == null ? mNote(A) : undefined, bNote: profit(B) == null ? mNote(B) : undefined, direction: "higher", totals: true, note: (farm(A) && !A.s.money.costComplete) || (farm(B) && !B.s.money.costComplete) ? `Cost inputs missing (counted as missing, not zero): ${[...new Set([...(farm(A) ? A.s.money.missing : []), ...(farm(B) ? B.s.money.missing : [])])].join(", ")}. Profit is an incomplete estimate.` : undefined });
  add({ key: "profitDay", group: "Money (estimate)", label: "Estimated profit per day", fmt: "inr", a: profitDay(A), b: profitDay(B), aNote: profitDay(A) == null ? mNote(A) : undefined, bNote: profitDay(B) == null ? mNote(B) : undefined, direction: "higher" });
  return rows;
}

/** Day-by-day series for the overlay charts: day 1..N of each range (null where there is no data). */
export function overlaySeries(x: SideResult): { date: string; hd: number | null; eggs: number | null }[] {
  const by = new Map(x.s.series.map((p) => [p.date, p]));
  const out: { date: string; hd: number | null; eggs: number | null }[] = [];
  for (let i = 0; i < x.side.range.days; i++) {
    const d = addDays(x.side.range.from, i);
    const p = by.get(d);
    out.push({ date: d, hd: p ? p.hd : null, eggs: p ? p.eggs : null });
  }
  return out;
}
