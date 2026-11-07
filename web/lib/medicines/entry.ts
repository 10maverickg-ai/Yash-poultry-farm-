// One entry on the Medicines screen (V14 Q3): pick an item from the master list, tick one or more flocks, a date, an optional quantity and
// an optional cost. One register line is written PER FLOCK, so per-flock reports are exact. A total quantity or cost typed for several
// flocks is split by the number of birds in each flock on that date (equal shares when a flock's bird count is not known), and the lines
// always add up to the typed total exactly. Pure functions, no database.
import { parseDate } from "@/lib/import/paperHistory";
import { lookup, validateItem, type CatalogueItem, type ItemKind } from "./catalogue";

export interface EntryFlock { id: string; label: string; birds: number | null }
export interface EntryItemChoice {
  item: CatalogueItem | null; // an item of the list ...
  create: { name: string; kind: Exclude<ItemKind, "management">; purpose: string | null } | null; // ... or a new one, added as "to confirm"
  note: string | null; // e.g. "that name was already in the list: used it"
}
export interface Entry {
  date: string;
  choice: EntryItemChoice;
  flockIds: string[];
  quantity: number | null; // the TOTAL typed for the whole entry
  unit: string | null;
  cost: number | null; // the TOTAL typed for the whole entry; null = cost not entered
  supplier: string | null;
  note: string | null;
}
export type EntryRaw = { date?: string; catalogue_id?: string; new_name?: string; new_kind?: string; new_purpose?: string; flock_ids: string[]; quantity?: string; unit?: string; cost?: string; supplier?: string; note?: string };

const inr = (x: number): string => "₹" + x.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(x) ? 0 : 2, maximumFractionDigits: 2 });
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

export function validateEntry(raw: EntryRaw, items: CatalogueItem[], flocks: EntryFlock[], today = todayISO()): { ok: true; entry: Entry } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const date = (raw.date ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || parseDate(date) == null) errors.push("Choose the date written in the register.");
  else if (date > today) errors.push(`${date} is in the future. Choose the date the medicine was given or bought.`);

  // the item: from the list, or a new one typed in (which is added to the list as "to confirm")
  let choice: EntryItemChoice = { item: null, create: null, note: null };
  const newName = clean(raw.new_name);
  if (newName) {
    const kind = (raw.new_kind ?? "").trim();
    const v = validateItem({ name: newName, kind, purpose: raw.new_purpose }, items.filter(() => false)); // checks the name's shape only
    const known = lookup(items, newName);
    if (known) {
      if (known.item.kind === "management") errors.push(`“${known.item.name}” is a farm task, not a medicine. It is ticked off in the chick plan.`);
      else if (!known.item.active) errors.push(`“${known.item.name}” is in the list but taken out of the pick list. Put it back in the Medicines list first.`);
      else choice = { item: known.item, create: null, note: `“${newName}” was already in the list as “${known.item.name}”: that one is used.` };
    } else if (kind !== "vaccine" && kind !== "medicine") errors.push("Say whether the new item is a vaccine or a medicine.");
    else if (!v.ok) errors.push(...v.errors);
    else choice = { item: null, create: { name: v.item.name, kind, purpose: v.item.purpose }, note: null };
  } else {
    const id = Number(raw.catalogue_id);
    const item = Number.isInteger(id) ? items.find((i) => i.id === id) : undefined;
    if (!item) errors.push("Pick the medicine or vaccine from the list, or add a new one.");
    else if (item.kind === "management") errors.push(`“${item.name}” is a farm task, not a medicine.`);
    else if (!item.active) errors.push(`“${item.name}” is out of the pick list. Put it back in the Medicines list first.`);
    else choice = { item, create: null, note: null };
  }

  const flockIds = [...new Set(raw.flock_ids.map((s) => s.trim()).filter(Boolean))];
  if (flockIds.length === 0) errors.push("Tick at least one flock (or tap “Whole farm”).");
  else if (flockIds.some((id) => !flocks.some((f) => f.id === id))) errors.push("One of the ticked flocks is not in the app.");

  const q = numOrNull(raw.quantity);
  if (q === "bad") errors.push("The quantity must be a number, for example 2 or 0.5.");
  const c = numOrNull(raw.cost);
  if (c === "bad") errors.push("The cost must be a number in rupees, for example 850. Leave it empty if the register has no price.");
  const unit = clean(raw.unit);
  if (q != null && q !== "bad" && !unit) errors.push("Say the unit (bottles, vials, doses, kg…) or leave the quantity empty.");
  if (errors.length) return { ok: false, errors };
  return { ok: true, entry: { date, choice, flockIds, quantity: q === "bad" ? null : q, unit, cost: c === "bad" ? null : c, supplier: clean(raw.supplier), note: clean(raw.note) } };
}

/** Splits `total` into integer multiples of 10^-decimals in proportion to `weights`; the parts add up to the total exactly (largest remainder). */
export function splitTotal(total: number, weights: number[], decimals: number): number[] {
  const scale = 10 ** decimals;
  const units = Math.round(total * scale);
  const sum = weights.reduce((s, w) => s + w, 0);
  if (weights.length === 0) return [];
  if (!(sum > 0)) return splitTotal(total, weights.map(() => 1), decimals);
  const exact = weights.map((w) => (units * w) / sum);
  const parts = exact.map((x) => Math.floor(x));
  let left = units - parts.reduce((s, p) => s + p, 0);
  const order = exact.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) parts[order[k].i]++;
  return parts.map((p) => p / scale);
}

export interface EntryPart { flockId: string; label: string; birds: number | null; quantity: number | null; cost: number | null }
export interface EntryPlan { parts: EntryPart[]; basis: "birds" | "equal" | null; costTotal: number | null; quantityTotal: number | null }

/** One part per flock. One flock: no split. Several: by birds when every flock has a bird count, else equal shares (basis says which). */
export function planEntry(e: Pick<Entry, "flockIds" | "quantity" | "cost">, flocks: EntryFlock[]): EntryPlan {
  const picked = e.flockIds.map((id) => flocks.find((f) => f.id === id)!).filter(Boolean);
  if (picked.length <= 1) {
    return { parts: picked.map((f) => ({ flockId: f.id, label: f.label, birds: f.birds, quantity: e.quantity, cost: e.cost })), basis: null, costTotal: null, quantityTotal: null };
  }
  const byBirds = picked.every((f) => f.birds != null && f.birds > 0);
  const weights = picked.map((f) => (byBirds ? (f.birds as number) : 1));
  const qs = e.quantity != null ? splitTotal(e.quantity, weights, 3) : null;
  const cs = e.cost != null ? splitTotal(e.cost, weights, 2) : null;
  return {
    parts: picked.map((f, i) => ({ flockId: f.id, label: f.label, birds: f.birds, quantity: qs ? qs[i] : null, cost: cs ? cs[i] : null })),
    basis: byBirds ? "birds" : "equal",
    costTotal: e.cost,
    quantityTotal: e.quantity,
  };
}

/** The plain sentence that says how a total was shared (shown on screen after saving and while typing). */
export function describeSplit(plan: EntryPlan, unit: string | null): string {
  if (!plan.basis) return "";
  const how = plan.basis === "birds" ? "split by the number of birds in each flock" : "split equally between the flocks (the number of birds is not known for every flock)";
  const bits: string[] = [];
  if (plan.costTotal != null) bits.push(`the cost ${inr(plan.costTotal)}`);
  if (plan.quantityTotal != null) bits.push(`the quantity ${plan.quantityTotal} ${unit ?? ""}`.trim());
  if (bits.length === 0) return "";
  const each = plan.parts.map((p) => `${p.label} ${[p.cost != null ? inr(p.cost) : null, p.quantity != null ? `${p.quantity} ${unit ?? ""}`.trim() : null].filter(Boolean).join(" · ")}`).join("; ");
  const sentence = `${bits.join(" and ")} was ${how}: ${each}.`;
  return sentence[0].toUpperCase() + sentence.slice(1);
}
