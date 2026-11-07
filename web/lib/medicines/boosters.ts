// Boosters every 6 months (V14 Q5). Pure functions, no database. A rule says "this vaccine is repeated every N months for all laying
// flocks"; the last time it was given comes from the register lines (any list item that counts for the rule). NOTHING IS ASSUMED: a flock
// with no recorded date is "last date not entered" (amber), never "done" and never zero.

import { dmy } from "@/lib/format";

export const SOON_DAYS = 14;

const pad = (n: number) => String(n).padStart(2, "0");
const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m = 1..12

/** A date plus whole calendar months; a day that does not exist in the target month becomes that month's last day (31 Aug + 6 months = 28 Feb). */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  const ty = Math.floor(idx / 12);
  const tm = (idx % 12) + 1;
  return `${ty}-${pad(tm)}-${pad(Math.min(d, daysIn(ty, tm)))}`;
}
export const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);

export interface RuleDef { id: number; code: string; label: string; repeatMonths: number; itemIds: number[]; mainItemId: number | null }
export interface LayingFlock { id: string; label: string; shed: string | null; segment: "main" | "young" | null }
/** A register line that may count towards a rule. scope farm counts for every laying flock; scope shed for the flocks now in that shed. */
export interface GivenLine { scope: "farm" | "flock" | "shed"; flockId: string | null; shedCode: string | null; date: string; catalogueId: number | null }

export type BoosterStatus = "done" | "soon" | "overdue" | "no_date";
export interface BoosterCell {
  ruleCode: string;
  label: string;
  repeatMonths: number;
  last: string | null;
  next: string | null;
  status: BoosterStatus;
  daysToDue: number | null; // negative = overdue by that many days
}

export function lastGiven(rule: RuleDef, flock: LayingFlock, lines: GivenLine[], today: string): string | null {
  let best: string | null = null;
  for (const l of lines) {
    if (l.catalogueId == null || !rule.itemIds.includes(l.catalogueId) || l.date > today) continue;
    const counts = l.scope === "farm" || (l.scope === "flock" && l.flockId === flock.id) || (l.scope === "shed" && l.shedCode != null && l.shedCode === flock.shed);
    if (counts && (best == null || l.date > best)) best = l.date;
  }
  return best;
}

export function boosterFor(rule: RuleDef, flock: LayingFlock, lines: GivenLine[], today: string, soonDays = SOON_DAYS): BoosterCell {
  const last = lastGiven(rule, flock, lines, today);
  const base = { ruleCode: rule.code, label: rule.label, repeatMonths: rule.repeatMonths, last };
  if (!last) return { ...base, next: null, status: "no_date", daysToDue: null };
  const next = addMonths(last, rule.repeatMonths);
  const d = daysBetween(today, next);
  return { ...base, next, status: d < 0 ? "overdue" : d <= soonDays ? "soon" : "done", daysToDue: d };
}

export interface FlockBoosters { flock: LayingFlock; cells: BoosterCell[] }
export const boosterTable = (rules: RuleDef[], flocks: LayingFlock[], lines: GivenLine[], today: string): FlockBoosters[] =>
  flocks.map((flock) => ({ flock, cells: rules.map((r) => boosterFor(r, flock, lines, today)) }));

export interface BoosterAlert { id: string; title: string; detail: string; href: string }

/**
 * Today's "may go wrong soon" lines: ONE per vaccine (overdue and due within 14 days together, the flocks listed), plus ONE line when some
 * flocks have no last date. At most (rules + 1) lines however many flocks there are: no alert storms.
 */
export function boosterAlerts(table: FlockBoosters[], rules: RuleDef[], today: string, href = "/medicines/flocks"): BoosterAlert[] {
  const out: BoosterAlert[] = [];
  const names = (xs: string[]) => (xs.length <= 6 ? xs.join(", ") : `${xs.slice(0, 5).join(", ")} and ${xs.length - 5} more`);
  const plural = (n: number) => (n === 1 ? "flock" : "flocks");
  for (const r of rules) {
    const cells = table.map((t) => ({ flock: t.flock, c: t.cells.find((c) => c.ruleCode === r.code)! }));
    const over = cells.filter((x) => x.c.status === "overdue").sort((a, b) => (a.c.daysToDue! - b.c.daysToDue!));
    const soon = cells.filter((x) => x.c.status === "soon").sort((a, b) => (a.c.daysToDue! - b.c.daysToDue!));
    if (over.length === 0 && soon.length === 0) continue;
    const parts: string[] = [];
    if (over.length) parts.push(`Overdue: ${names(over.map((x) => `${x.flock.label} (${-x.c.daysToDue!} day${-x.c.daysToDue! === 1 ? "" : "s"})`))}.`);
    if (soon.length) parts.push(`Due within ${SOON_DAYS} days: ${names(soon.map((x) => `${x.flock.label} (${dmy(x.c.next!)})`))}.`);
    out.push({
      id: `booster-${r.code}`,
      title: over.length ? `${r.label} is overdue for ${over.length} ${plural(over.length)}${soon.length ? ` and due soon for ${soon.length}` : ""}.` : `${r.label} is due within ${SOON_DAYS} days for ${soon.length} ${plural(soon.length)}.`,
      detail: parts.join(" "),
      href,
    });
  }
  const missing = table.filter((t) => t.cells.some((c) => c.status === "no_date"));
  if (missing.length > 0) {
    const which = rules.filter((r) => table.some((t) => t.cells.find((c) => c.ruleCode === r.code)?.status === "no_date")).map((r) => r.label);
    out.push({ id: "booster-no-date", title: `The last booster date is not entered for ${missing.length} ${plural(missing.length)} (${which.join(", ")}).`, detail: "Until it is entered the app cannot tell when the next booster is due. Nothing is assumed.", href });
  }
  void today;
  return out;
}

/** Plain words for a booster cell: "done 12 Oct 2026, next due 12 Apr 2027", "due in 9 days", "3 days overdue", "last date not entered". */
export function boosterWords(c: BoosterCell, fmt: (d: string) => string): string {
  if (c.status === "no_date") return "Last date not entered";
  if (c.status === "overdue") return `${-c.daysToDue!} day${-c.daysToDue! === 1 ? "" : "s"} overdue (was due ${fmt(c.next!)})`;
  if (c.status === "soon") return c.daysToDue === 0 ? `Due today (${fmt(c.next!)})` : `Due in ${c.daysToDue} day${c.daysToDue === 1 ? "" : "s"} (${fmt(c.next!)})`;
  return `Done ${fmt(c.last!)}, next due ${fmt(c.next!)}`;
}
