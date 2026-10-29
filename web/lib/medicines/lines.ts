// The medicine and vaccine register (V12 N3): one line per medicine or vaccine given or bought. Pure functions, no database, so
// scripts/medicines-check.mts can test them. A line's cost is OPTIONAL: no cost means "cost not entered", never ₹0.
import { parseCsv, parseDate } from "@/lib/import/paperHistory";

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
}
export interface LineRow extends LineInput { id: number; photoUrl: string | null; sourceTag: string; targetLabel: string }

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

// ---- import from CSV / Excel ------------------------------------------------------------------------------------------------
export const IMPORT_TAG = "register import";
export const IMPORT_TEMPLATE = "date,type,name,for,quantity,unit,cost,supplier,note\n2026-07-04,medicine,Enrofloxacin,BAB-3,2,bottles,850,Kisan Vet Store,5 days in water\n2026-07-10,vaccine,Ranikhet (Lasota),farm,3,vials,420,,whole farm\n";
const HEADS: Record<string, string[]> = {
  date: ["date", "day"],
  type: ["type", "kind", "medicine or vaccine"],
  name: ["name", "item", "what", "medicine", "medicine name", "vaccine name"],
  for: ["for", "flock", "flock or shed", "shed", "given to"],
  quantity: ["quantity", "qty", "amount"],
  unit: ["unit", "units"],
  cost: ["cost", "price", "rupees", "cost (rs)", "amount (rs)", "₹"],
  supplier: ["supplier", "bought from", "shop"],
  note: ["note", "notes", "remark", "remarks"],
};
export interface ImportRowResult {
  line: number;
  state: "ok" | "exists" | "error";
  errors: string[];
  warnings: string[];
  input: LineInput | null;
  raw: { date: string; name: string; target: string };
}
export interface ImportReport { rows: ImportRowResult[]; columnProblems: string[]; counts: { total: number; ok: number; exists: number; error: number } }

/** A line is "the same" as an existing one when date, kind, name, target, quantity and unit all match (so importing twice never doubles). */
export const dupKey = (l: Pick<LineInput, "date" | "kind" | "item" | "scope" | "flockId" | "shedCode" | "quantity" | "unit">) =>
  [l.date, l.kind, l.item.toLowerCase(), l.scope, l.flockId ?? "", l.shedCode ?? "", l.quantity ?? "", (l.unit ?? "").toLowerCase()].join("|");

export function parseImport(
  text: string | string[][],
  flocks: { id: string; label: string }[],
  sheds: string[],
  existing: Set<string>,
  today = todayISO(),
): ImportReport {
  const table = typeof text === "string" ? parseCsv(text) : text;
  const problems: string[] = [];
  if (table.length === 0) return { rows: [], columnProblems: ["The file is empty."], counts: { total: 0, ok: 0, exists: 0, error: 0 } };
  const head = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, " "));
  const col: Record<string, number> = {};
  for (const [k, names] of Object.entries(HEADS)) {
    const i = head.findIndex((h) => names.includes(h));
    if (i >= 0) col[k] = i;
  }
  for (const need of ["date", "type", "name"]) if (col[need] == null) problems.push(`Column "${need === "name" ? "name" : need}" not found. Use the template.`);
  const byFlock = new Map(flocks.map((f) => [f.label.trim().toLowerCase(), f.id]));
  const byShed = new Map(sheds.map((s) => [s.trim().toLowerCase(), s]));
  const seen = new Set<string>();
  const rows: ImportRowResult[] = [];
  if (problems.length === 0) {
    table.slice(1).forEach((cells, i) => {
      const get = (k: string) => (col[k] == null ? "" : (cells[col[k]] ?? "").trim());
      const dateIso = parseDate(get("date")) ?? "";
      const forRaw = get("for");
      const f = forRaw.toLowerCase();
      let target = "farm";
      const warnings: string[] = [];
      const errors: string[] = [];
      if (f !== "" && !["farm", "whole farm", "all", "all flocks"].includes(f)) {
        if (byFlock.has(f)) target = `flock:${byFlock.get(f)}`;
        else if (byShed.has(f)) target = `shed:${byShed.get(f)}`;
        else errors.push(`"${forRaw}" is not a flock or a shed in the app. Use a flock name such as BAB-3, a shed name, or "farm".`);
      }
      const typeRaw = get("type").toLowerCase();
      const kind = ["medicine", "med", "medicines", "m", "दवा"].includes(typeRaw) ? "medicine" : ["vaccine", "vaccines", "vac", "v", "vaccination"].includes(typeRaw) ? "vaccine" : typeRaw;
      const v = validateLine({ date: dateIso, kind, item: get("name"), target, quantity: get("quantity"), unit: get("unit"), cost: get("cost"), supplier: get("supplier"), note: get("note") }, today);
      const lineNo = i + 2;
      const raw = { date: get("date"), name: get("name"), target: forRaw || "farm" };
      if (!v.ok) {
        rows.push({ line: lineNo, state: "error", errors: [...errors, ...v.errors], warnings, input: null, raw });
        return;
      }
      if (errors.length) {
        rows.push({ line: lineNo, state: "error", errors, warnings, input: null, raw });
        return;
      }
      if (v.line.cost == null) warnings.push("no cost: counted as 'cost not entered', not zero");
      const key = dupKey(v.line);
      if (seen.has(key)) {
        rows.push({ line: lineNo, state: "error", errors: ["the same line appears twice in the file"], warnings, input: null, raw });
        return;
      }
      seen.add(key);
      rows.push({ line: lineNo, state: existing.has(key) ? "exists" : "ok", errors: [], warnings, input: v.line, raw });
    });
  }
  const counts = { total: rows.length, ok: rows.filter((r) => r.state === "ok").length, exists: rows.filter((r) => r.state === "exists").length, error: rows.filter((r) => r.state === "error").length };
  return { rows, columnProblems: problems, counts };
}

/** What the edit form starts with (kept here, not in the client form file, because the page calls it on the server). */
export const defaultsFromLine = (l: LineRow) => ({ date: l.date, kind: l.kind as string, target: targetValue(l), item: l.item, quantity: l.quantity, unit: l.unit, cost: l.cost, supplier: l.supplier, note: l.note });
