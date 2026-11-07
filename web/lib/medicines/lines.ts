// The medicine and vaccine register (V12 N3): one line per medicine or vaccine given or bought. Pure functions, no database, so
// scripts/medicines-check.mts can test them. A line's cost is OPTIONAL: no cost means "cost not entered", never ₹0.
import { parseDate } from "@/lib/import/paperHistory";

export const KINDS = [
  { key: "medicine", label: "Medicine" },
  { key: "vaccine", label: "Vaccine" },
] as const;
export type Kind = (typeof KINDS)[number]["key"];
export const UNITS = ["bottles", "vials", "doses", "packets", "sachets", "tablets", "boxes", "bags", "kg", "g", "litres", "ml"] as const;
export type Scope = "farm" | "flock" | "shed";

export interface Target { scope: Scope; flockId: string | null; shedCode: string | null }
export interface LineInput extends Target {
  date: string;
  kind: Kind;
  item: string;
  quantity: number | null;
  unit: string | null;
  cost: number | null; // null = cost not entered
  supplier: string | null;
  note: string | null;
  // V14: which list item, which entry it was saved with, and what was typed for the whole entry (all optional)
  catalogueId?: number | null;
  entryGroup?: string | null;
  costTotal?: number | null;
  quantityTotal?: number | null;
  splitBasis?: "birds" | "equal" | null;
}
export interface LineRow extends LineInput {
  id: number;
  photoUrl: string | null;
  sourceTag: string;
  targetLabel: string;
  catalogueId: number | null;
  listName: string | null; // the list item's name (null = typed name not matched to the list)
  entryGroup: string | null;
  costTotal: number | null;
  quantityTotal: number | null;
  splitBasis: "birds" | "equal" | null;
}

const todayISO = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); // India date
const clean = (s: string | null | undefined) => {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t === "" ? null : t;
};
const numOrNull = (s: string | null | undefined): number | null | "bad" => {
  const t = (s ?? "").replace(/[,₹\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : "bad";
};

/** "farm" | "flock:<uuid>" | "shed:<code>" (the value of the "For" box on the form). */
export function parseTarget(v: string | null | undefined): Target | null {
  const s = (v ?? "").trim();
  if (s === "" || s === "farm") return { scope: "farm", flockId: null, shedCode: null };
  if (s.startsWith("flock:") && s.length > 6) return { scope: "flock", flockId: s.slice(6), shedCode: null };
  if (s.startsWith("shed:") && s.length > 5) return { scope: "shed", flockId: null, shedCode: s.slice(5) };
  return null;
}
export const targetValue = (t: Target) => (t.scope === "flock" ? `flock:${t.flockId}` : t.scope === "shed" ? `shed:${t.shedCode}` : "farm");

/** Checks one form submission. Returns plain-words errors, never throws. */
export function validateLine(raw: Record<string, string | null | undefined>, today = todayISO()): { ok: true; line: LineInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const date = (raw.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || parseDate(date) == null) errors.push("Choose the date written in the register.");
  else if (date > today) errors.push(`${date} is in the future. Choose the date the medicine was given or bought.`);
  const kind = (raw.kind ?? "").trim();
  if (kind !== "medicine" && kind !== "vaccine") errors.push("Choose medicine or vaccine.");
  const item = clean(raw.item);
  if (!item) errors.push("Write the name of the medicine or vaccine.");
  else if (item.length > 120) errors.push("The name is too long (120 letters at most).");
  const target = parseTarget(raw.target);
  if (!target) errors.push("Choose what it was for: the whole farm, a flock or a shed.");
  const q = numOrNull(raw.quantity);
  if (q === "bad") errors.push("The quantity must be a number, for example 2 or 0.5.");
  const c = numOrNull(raw.cost);
  if (c === "bad") errors.push("The cost must be a number in rupees, for example 850. Leave it empty if the register has no price.");
  const unit = clean(raw.unit);
  if (q != null && q !== "bad" && !unit) errors.push("Say the unit (bottles, vials, doses, kg…) or leave the quantity empty.");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    line: { ...target!, date, kind: kind as Kind, item: item!, quantity: q === "bad" ? null : q, unit, cost: c === "bad" ? null : c, supplier: clean(raw.supplier), note: clean(raw.note) },
  };
}

// ---- month totals ---------------------------------------------------------------------------------------------------------
export interface MonthSummary {
  month: string;
  lines: number;
  cost: number; // sum of the costs that WERE entered
  withoutCost: number; // lines with no cost entered (not zero)
  byKind: { kind: Kind; lines: number; cost: number; withoutCost: number }[];
  byTarget: { label: string; lines: number; cost: number; withoutCost: number }[];
}
export function monthSummary(lines: Pick<LineRow, "date" | "kind" | "cost" | "targetLabel">[], month: string): MonthSummary {
  const inM = lines.filter((l) => l.date.startsWith(month));
  const targets = new Map<string, { label: string; lines: number; cost: number; withoutCost: number }>();
  for (const l of inM) {
    const t = targets.get(l.targetLabel) ?? { label: l.targetLabel, lines: 0, cost: 0, withoutCost: 0 };
    t.lines++;
    if (l.cost == null) t.withoutCost++;
    else t.cost += l.cost;
    targets.set(l.targetLabel, t);
  }
  return {
    month,
    lines: inM.length,
    cost: inM.reduce((s, l) => s + (l.cost ?? 0), 0),
    withoutCost: inM.filter((l) => l.cost == null).length,
    byKind: KINDS.map((k) => ({ kind: k.key, lines: inM.filter((l) => l.kind === k.key).length, cost: inM.filter((l) => l.kind === k.key).reduce((s, l) => s + (l.cost ?? 0), 0), withoutCost: inM.filter((l) => l.kind === k.key && l.cost == null).length })),
    byTarget: [...targets.values()].sort((a, b) => b.cost - a.cost || a.label.localeCompare(b.label, undefined, { numeric: true })),
  };
}

/** Which months have lines (newest first), plus the month asked for. */
export function monthsOf(lines: { date: string }[], also: string): string[] {
  return [...new Set([also, ...lines.map((l) => l.date.slice(0, 7))])].sort().reverse();
}

// ---- vaccination schedule ---------------------------------------------------------------------------------------------------
export interface ScheduleItem { id: number; vaccine: string; dueDate: string; givenDate: string | null; target: string; route: string | null; note: string | null }
export interface ScheduleGroups { overdue: ScheduleItem[]; soon: ScheduleItem[]; later: ScheduleItem[]; done: ScheduleItem[] }
export const SOON_DAYS = 14;
const addDaysISO = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * 86400000).toISOString().slice(0, 10);
/** Done (given), overdue (due before today, not given), due soon (within 14 days), later. */
export function groupSchedule(items: ScheduleItem[], today = todayISO(), soonDays = SOON_DAYS): ScheduleGroups {
  const g: ScheduleGroups = { overdue: [], soon: [], later: [], done: [] };
  const edge = addDaysISO(today, soonDays);
  for (const i of items) {
    if (i.givenDate) g.done.push(i);
    else if (i.dueDate < today) g.overdue.push(i);
    else if (i.dueDate <= edge) g.soon.push(i);
    else g.later.push(i);
  }
  g.overdue.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  g.soon.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  g.later.sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1));
  g.done.sort((a, b) => ((a.givenDate ?? "") < (b.givenDate ?? "") ? 1 : -1));
  return g;
}

export const IMPORT_TAG = "register import";

/** What the edit form starts with (kept here, not in the client form file, because the page calls it on the server). */
export const defaultsFromLine = (l: LineRow) => ({ date: l.date, kind: l.kind as string, target: targetValue(l), item: l.item, catalogueId: l.catalogueId, quantity: l.quantity, unit: l.unit, cost: l.cost, supplier: l.supplier, note: l.note });
