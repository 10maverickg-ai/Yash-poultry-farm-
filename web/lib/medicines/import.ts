// Import of register lines from CSV / Excel (V14 Q7): the name must be an item of the Medicines list (or one of its other spellings), the
// flock column can name several flocks (BAB-1; BAB-2), a group (main, young) or the whole farm, and a total quantity or cost is split by the
// birds in each flock on that date exactly like the entry screen does. A name the list does not know is NEVER created silently: it is listed
// for the owner to match to a list item, add as a new "to confirm" item, or leave out. Pure functions, no database.
import { parseCsv, parseDate } from "@/lib/import/paperHistory";
import { lookup, norm, tidy, type CatalogueItem } from "./catalogue";
import { planEntry, type EntryPlan } from "./entry";

export const IMPORT_TEMPLATE =
  "date,name,flock,quantity,unit,cost,supplier,note\n" +
  "2026-10-20,Levofloxacin,BAB-1; BAB-2,3,bottles,1000,Kisan Vet Store,5 days in the water\n" +
  "2026-10-21,ND booster (lay),main,2,vials,,,whole main group\n" +
  "2026-10-22,Fowlpox,all,,,,,\n";

const HEADS: Record<string, string[]> = {
  date: ["date", "day"],
  name: ["name", "item", "what", "medicine", "medicine name", "vaccine name", "vaccine"],
  flock: ["flock", "flocks", "for", "given to", "flock or shed", "shed"],
  type: ["type", "kind", "medicine or vaccine"],
  quantity: ["quantity", "qty", "amount"],
  unit: ["unit", "units"],
  cost: ["cost", "price", "rupees", "cost (rs)", "amount (rs)", "₹"],
  supplier: ["supplier", "bought from", "shop"],
  note: ["note", "notes", "remark", "remarks"],
};

export interface ImportFlock { id: string; label: string; segment: "main" | "young" | null; shed: string | null }
export interface ImportCtx {
  items: CatalogueItem[];
  flocks: ImportFlock[]; // active flocks
  birds: (date: string, flockId: string) => number | null;
  existing: Set<string>; // lineKey() of every line already in the register
  mapping: Record<string, string>; // norm(name) -> "item:<id>" | "new:vaccine" | "new:medicine" | "skip" (the owner's answers for unknown names)
  today: string;
}
export type RowState = "ok" | "exists" | "error" | "unknown" | "skipped";
export interface ImportItem { id: number | null; name: string; kind: "vaccine" | "medicine"; create: boolean }
export interface ImportRow {
  line: number;
  state: RowState;
  errors: string[];
  warnings: string[];
  raw: { date: string; name: string; flock: string };
  item: ImportItem | null;
  date: string | null;
  plan: EntryPlan | null;
  unit: string | null;
  supplier: string | null;
  note: string | null;
}
export interface UnknownName { key: string; name: string; rows: number[]; kindHint: "vaccine" | "medicine" | null }
export interface ImportReport {
  rows: ImportRow[];
  columnProblems: string[];
  counts: { total: number; ok: number; exists: number; error: number; unknown: number; skipped: number };
  unknown: UnknownName[];
}

/** One register line is "the same" when the date, the item and the flock match (so importing twice never doubles a line). */
export const lineKey = (date: string, catalogueId: number | null, name: string, flockId: string | null): string => `${date}|${catalogueId != null ? `c${catalogueId}` : `n:${norm(name)}`}|${flockId ?? "-"}`;

const numOrNull = (s: string): number | null | "bad" => {
  const t = s.replace(/[,₹\s]/g, "");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : "bad";
};

function columns(table: string[][]): { col: Record<string, number>; problems: string[] } {
  const head = table[0].map((h) => h.trim().toLowerCase().replace(/\s+/g, " "));
  const col: Record<string, number> = {};
  for (const [k, names] of Object.entries(HEADS)) {
    const i = head.findIndex((h) => names.includes(h));
    if (i >= 0) col[k] = i;
  }
  const problems: string[] = [];
  for (const need of ["date", "name"]) if (col[need] == null) problems.push(`Column "${need}" not found. Use the template.`);
  return { col, problems };
}

/** Every date in the file (so the bird counts for those dates can be read before the lines are worked out). */
export function importDates(text: string | string[][]): string[] {
  const table = typeof text === "string" ? parseCsv(text) : text;
  if (table.length < 2) return [];
  const { col, problems } = columns(table);
  if (problems.length) return [];
  return [...new Set(table.slice(1).map((r) => parseDate((r[col.date] ?? "").trim()) ?? "").filter(Boolean))];
}

/** Which flocks a "flock" cell means: names (separated by ; or ,), main, young, a shed, or the whole farm (also when empty). */
export function resolveFlocks(cell: string, flocks: ImportFlock[]): { ids: string[]; errors: string[]; warnings: string[] } {
  const tokens = cell.split(/[;,]/).map((t) => tidy(t)).filter(Boolean);
  const ids = new Set<string>();
  const errors: string[] = [];
  const warnings: string[] = [];
  if (tokens.length === 0) {
    flocks.forEach((f) => ids.add(f.id));
    warnings.push("no flock named: counted for the whole farm");
  }
  for (const t of tokens) {
    const k = norm(t);
    if (["farm", "whole farm", "all", "all flocks", "everyone"].includes(k)) flocks.forEach((f) => ids.add(f.id));
    else if (k === "main" || k === "main group") flocks.filter((f) => f.segment === "main").forEach((f) => ids.add(f.id));
    else if (k === "young" || k === "young group") flocks.filter((f) => f.segment === "young").forEach((f) => ids.add(f.id));
    else {
      const f = flocks.find((x) => norm(x.label) === k);
      const shed = flocks.filter((x) => x.shed && norm(x.shed) === k);
      if (f) ids.add(f.id);
      else if (shed.length) shed.forEach((x) => ids.add(x.id));
      else errors.push(`"${t}" is not a flock, a group or a shed in the app. Use a flock name such as BAB-3, main, young or all.`);
    }
  }
  return { ids: flocks.filter((f) => ids.has(f.id)).map((f) => f.id), errors, warnings };
}

export function parseImport(text: string | string[][], ctx: ImportCtx): ImportReport {
  const table = typeof text === "string" ? parseCsv(text) : text;
  const empty = { total: 0, ok: 0, exists: 0, error: 0, unknown: 0, skipped: 0 };
  if (table.length === 0) return { rows: [], columnProblems: ["The file is empty."], counts: empty, unknown: [] };
  const { col, problems } = columns(table);
  if (problems.length) return { rows: [], columnProblems: problems, counts: empty, unknown: [] };
  const rows: ImportRow[] = [];
  const unknown = new Map<string, UnknownName>();
  const seen = new Set<string>();
  table.slice(1).forEach((cells, i) => {
    const get = (k: string) => (col[k] == null ? "" : (cells[col[k]] ?? "").trim());
    const line = i + 2;
    if (cells.every((c) => c.trim() === "")) return;
    const raw = { date: get("date"), name: get("name"), flock: get("flock") };
    const base: ImportRow = { line, state: "error", errors: [], warnings: [], raw, item: null, date: null, plan: null, unit: null, supplier: null, note: null };
    const errors: string[] = [];
    const warnings: string[] = [];

    const date = parseDate(raw.date);
    if (!date) errors.push("The date is not understood. Use 2026-07-04 or 04/07/2026.");
    else if (date > ctx.today) errors.push(`${date} is in the future.`);

    // the item
    let item: ImportItem | null = null;
    let state: RowState | null = null;
    const typed = tidy(raw.name);
    if (!typed) errors.push("The name is empty.");
    else {
      const hit = lookup(ctx.items, typed);
      const typeHint = ((): "vaccine" | "medicine" | null => {
        const t = norm(get("type"));
        return ["vaccine", "vaccines", "vac", "v", "vaccination"].includes(t) ? "vaccine" : ["medicine", "medicines", "med", "m"].includes(t) ? "medicine" : null;
      })();
      if (hit) {
        if (hit.item.kind === "management") errors.push(`“${hit.item.name}” is a farm task, not a medicine.`);
        else if (!hit.item.active) errors.push(`“${hit.item.name}” is out of the pick list. Put it back in the Medicines list first.`);
        else {
          item = { id: hit.item.id, name: hit.item.name, kind: hit.item.kind, create: false };
          if (hit.via === "alias") warnings.push(`“${typed}” is another spelling of “${hit.item.name}”`);
          if (typeHint && typeHint !== hit.item.kind) warnings.push(`the file says ${typeHint} but the list says ${hit.item.kind}: the list wins`);
        }
      } else {
        const key = norm(typed);
        const m = ctx.mapping[key];
        if (m === "skip") state = "skipped";
        else if (m?.startsWith("item:")) {
          const target = ctx.items.find((x) => x.id === Number(m.slice(5)));
          if (!target || target.kind === "management" || !target.active) errors.push("The list item chosen for this name cannot be used.");
          else item = { id: target.id, name: target.name, kind: target.kind, create: false };
        } else if (m === "new:vaccine" || m === "new:medicine") item = { id: null, name: typed, kind: m === "new:vaccine" ? "vaccine" : "medicine", create: true };
        else {
          state = "unknown";
          const u = unknown.get(key) ?? { key, name: typed, rows: [], kindHint: typeHint };
          u.rows.push(line);
          unknown.set(key, u);
        }
      }
    }

    const flocks = resolveFlocks(raw.flock, ctx.flocks);
    errors.push(...flocks.errors);
    warnings.push(...flocks.warnings);
    const q = numOrNull(get("quantity"));
    if (q === "bad") errors.push("The quantity must be a number.");
    const c = numOrNull(get("cost"));
    if (c === "bad") errors.push("The cost must be a number in rupees.");
    const unit = tidy(get("unit")) || null;
    if (q != null && q !== "bad" && !unit) errors.push("A quantity needs a unit (bottles, vials, kg…).");

    if (errors.length) return void rows.push({ ...base, errors, warnings, item });
    if (state === "skipped") return void rows.push({ ...base, state, item: null, warnings: ["left out as you chose"] });
    if (state === "unknown" || !item || !date) return void rows.push({ ...base, state: "unknown", item: null, warnings });

    const quantity = q === "bad" ? null : q;
    const cost = c === "bad" ? null : c;
    if (cost == null) warnings.push("no cost: counted as “cost not entered”, not zero");
    const plan = planEntry({ flockIds: flocks.ids, quantity, cost }, ctx.flocks.map((f) => ({ id: f.id, label: f.label, birds: ctx.birds(date, f.id) })));
    const keys = plan.parts.map((p) => lineKey(date, item!.id, item!.name, p.flockId));
    if (keys.some((k) => seen.has(k))) return void rows.push({ ...base, errors: ["the same line appears twice in the file"], warnings, item, date });
    keys.forEach((k) => seen.add(k));
    const already = keys.filter((k) => ctx.existing.has(k)).length;
    rows.push({ ...base, state: already > 0 ? "exists" : "ok", errors: [], warnings, item, date, plan, unit, supplier: tidy(get("supplier")) || null, note: tidy(get("note")) || null });
  });
  const counts = { total: rows.length, ok: 0, exists: 0, error: 0, unknown: 0, skipped: 0 };
  for (const r of rows) counts[r.state]++;
  return { rows, columnProblems: [], counts, unknown: [...unknown.values()] };
}
