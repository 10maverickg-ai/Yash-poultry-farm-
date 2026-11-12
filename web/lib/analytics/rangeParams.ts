// V15: reading a custom range and a flock choice from the address (bookmarkable, no local storage).
// PURE: the Analytics page, the Compare screen and the Excel export all read the URL through here,
// so a link always shows the same numbers on screen and in the file.
//   ?view=custom&from=2026-09-01&to=2026-09-15&f=BAB-3&f=BAB-5
import { registerLabel, segmentOn, type Ctx, type Segment } from "./engine";
import { customRange, isIsoDate, lastDaysWithData, makeRange, type PeriodRange } from "./period";

export type Param = string | string[] | undefined;
export const one = (p: Param): string | undefined => (Array.isArray(p) ? p[0] : p);
const many = (p: Param): string[] => (p == null ? [] : Array.isArray(p) ? p : [p]).flatMap((x) => x.split(",")).map((x) => x.trim()).filter(Boolean);

/** A flock named in the address: its id, or its real name (any case). Labels are what the links use. */
export function resolveFlock(ctx: Ctx, token: string): string | null {
  if (ctx.flockById.has(token)) return token;
  const t = token.trim().toLowerCase();
  for (const f of ctx.flockById.values()) if (f.label.trim().toLowerCase() === t) return f.id;
  return null;
}

export interface FlockOption {
  id: string;
  label: string; // the real flock name
  registerLabel: string; // what the register calls it on the last day it has data
  segment: Segment | null;
  gone: boolean; // no rows on the last entered day of the farm
  firstDate: string;
  lastDate: string;
}

/** Every flock that has daily rows: main, then young, then flocks that have left; by name within each. */
export function flockOptions(ctx: Ctx): FlockOption[] {
  const last = ctx.dates[ctx.dates.length - 1];
  const out: FlockOption[] = [];
  for (const [id, rs] of ctx.byFlock) {
    if (rs.length === 0) continue;
    const f = ctx.flockById.get(id);
    const lastDate = rs[rs.length - 1].date;
    out.push({ id, label: f?.label ?? rs[rs.length - 1].label, registerLabel: registerLabel(ctx, id, lastDate), segment: segmentOn(ctx, id, lastDate), gone: lastDate !== last, firstDate: rs[0].date, lastDate });
  }
  const rank = (o: FlockOption) => (o.gone ? 2 : o.segment === "young" ? 1 : 0);
  return out.sort((a, b) => rank(a) - rank(b) || a.label.localeCompare(b.label, undefined, { numeric: true }));
}

export interface RangeChoice {
  range: PeriodRange;
  notes: string[]; // plain sentences: swapped, future left out, capped, a date that could not be read, an unknown flock
  isDefault: boolean;
  flockIds: string[]; // empty = all flocks
  flockLabels: string[];
}

/** Default = the last 14 days that have data. */
export function defaultRange(ctx: Ctx, today: string): PeriodRange {
  return lastDaysWithData(ctx, 14) ?? makeRange(today, today);
}

export function readRange(ctx: Ctx, sp: { from?: Param; to?: Param; f?: Param }, today: string): RangeChoice {
  const notes: string[] = [];
  const fromIn = one(sp.from);
  const toIn = one(sp.to);
  let range: PeriodRange;
  let isDefault = false;
  const fromOk = isIsoDate(fromIn);
  const toOk = isIsoDate(toIn);
  if (!fromOk && !toOk) {
    range = defaultRange(ctx, today);
    isDefault = true;
    if (fromIn || toIn) notes.push("The dates in the address could not be read, so the last 14 days with data are shown.");
  } else {
    // one date only = that single day
    const r = customRange(fromOk ? fromIn! : toIn!, toOk ? toIn! : fromIn!, { today });
    range = r.range;
    notes.push(...r.notes);
    if (!fromOk || !toOk) notes.push(`Only one date was given, so the range is that one day.`);
  }
  const flockIds: string[] = [];
  for (const t of many(sp.f)) {
    if (t.toLowerCase() === "all") continue;
    const id = resolveFlock(ctx, t);
    if (!id) notes.push(`No flock is called "${t}", so it is left out.`);
    else if (!flockIds.includes(id)) flockIds.push(id);
  }
  const flockLabels = flockIds.map((id) => ctx.flockById.get(id)?.label ?? id);
  return { range, notes, isDefault, flockIds, flockLabels };
}

/** The address of a range view (labels, not ids, so it can be read and bookmarked). */
export function rangeHref(from: string, to: string, flockLabels: string[] = []): string {
  const q = new URLSearchParams({ view: "custom", from, to });
  for (const l of flockLabels) q.append("f", l);
  return `/analytics?${q.toString()}`;
}
