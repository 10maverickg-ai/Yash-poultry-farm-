// The master list of medicines, vaccines and farm tasks (V14 Q2). Pure functions, no database, so scripts/medicines-v14-check.mts can test
// them. One word always means one item: names are compared without capital letters and extra spaces, and an alias can never be the name
// of another item. Nothing here invents a dose, a brand or a purpose: whatever the owner did not say stays empty.

export const ITEM_KINDS = [
  { key: "vaccine", label: "Vaccine" },
  { key: "medicine", label: "Medicine" },
  { key: "management", label: "Farm task (not a medicine)" },
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number]["key"];

export const ROUTES = [
  { key: "water", label: "In the drinking water" },
  { key: "feed", label: "In the feed" },
  { key: "injection", label: "Injection" },
  { key: "eye_drop", label: "Eye drop" },
  { key: "spray", label: "Spray" },
  { key: "wing_web", label: "Wing web (small stab in the wing)" },
  { key: "other", label: "Another way" },
] as const;
export type RouteKey = (typeof ROUTES)[number]["key"];

export const routeLabel = (r: string | null | undefined): string => ROUTES.find((x) => x.key === r)?.label ?? "";
export const kindLabel = (k: string): string => ITEM_KINDS.find((x) => x.key === k)?.label ?? k;
export const kindPlural = (k: string): string => (k === "vaccine" ? "Vaccines" : k === "medicine" ? "Medicines" : "Farm tasks");

/** What "to confirm" means, in one line (shown on every screen that has the badge). */
export const TO_CONFIRM_LINE = "“To confirm” means the owner wrote this name or detail from memory or as a guess: check it with the vet or the packet, then tap “Mark as confirmed”.";

export interface CatalogueItem {
  id: number;
  name: string;
  kind: ItemKind;
  purpose: string | null;
  route: RouteKey | null;
  dose: string | null;
  brand: string | null;
  unit: string | null;
  active: boolean;
  needsConfirmation: boolean;
  note: string | null;
  aliases: { id: number; alias: string }[];
  used: number; // register lines + chick-plan steps + rules that point at it
}

/** Capital letters, extra spaces and side spaces never make a second name. */
export const norm = (s: string | null | undefined): string => (s ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
export const tidy = (s: string | null | undefined): string => (s ?? "").normalize("NFKC").replace(/\s+/g, " ").trim();
const orNull = (s: string | null | undefined) => {
  const t = tidy(s);
  return t === "" ? null : t;
};

/** The list item a written name means (its name or one of its other spellings), or null. */
export function lookup(items: CatalogueItem[], text: string | null | undefined): { item: CatalogueItem; via: "name" | "alias" } | null {
  const k = norm(text);
  if (!k) return null;
  const byName = items.find((i) => norm(i.name) === k);
  if (byName) return { item: byName, via: "name" };
  const byAlias = items.find((i) => i.aliases.some((a) => norm(a.alias) === k));
  return byAlias ? { item: byAlias, via: "alias" } : null;
}

export interface ItemInput {
  name: string;
  kind: ItemKind;
  purpose: string | null;
  route: RouteKey | null;
  dose: string | null;
  brand: string | null;
  unit: string | null;
  note: string | null;
}

/** One form submission for a list item. Returns plain-words errors, never throws. `selfId` = the item being edited. */
export function validateItem(raw: Record<string, string | null | undefined>, items: CatalogueItem[], selfId: number | null = null): { ok: true; item: ItemInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const name = tidy(raw.name);
  if (!name) errors.push("Write the name as it is written on the packet or in the register.");
  else if (name.length > 80) errors.push("The name is too long (80 letters at most).");
  else {
    const clash = lookup(items.filter((i) => i.id !== selfId), name);
    if (clash) errors.push(clash.via === "name" ? `“${clash.item.name}” is already in the list. Use that one.` : `“${name}” is another spelling of “${clash.item.name}”, which is already in the list.`);
  }
  const kind = (raw.kind ?? "").trim();
  if (!ITEM_KINDS.some((k) => k.key === kind)) errors.push("Choose vaccine, medicine or farm task.");
  const route = (raw.route ?? "").trim();
  if (route && !ROUTES.some((r) => r.key === route)) errors.push("Choose how it is given from the list, or leave it empty.");
  if (errors.length) return { ok: false, errors };
  return { ok: true, item: { name, kind: kind as ItemKind, purpose: orNull(raw.purpose), route: (route || null) as RouteKey | null, dose: orNull(raw.dose), brand: orNull(raw.brand), unit: orNull(raw.unit), note: orNull(raw.note) } };
}

/** A new other spelling for an item. */
export function validateAlias(alias: string, items: CatalogueItem[], itemId: number): { ok: true; alias: string } | { ok: false; error: string } {
  const a = tidy(alias);
  if (!a) return { ok: false, error: "Write the other spelling." };
  if (a.length > 80) return { ok: false, error: "That spelling is too long (80 letters at most)." };
  const clash = lookup(items, a);
  if (clash) {
    if (clash.item.id === itemId) return { ok: false, error: `“${a}” already means this item.` };
    return { ok: false, error: `“${a}” already means “${clash.item.name}”. One spelling can only mean one item.` };
  }
  return { ok: true, alias: a };
}

/** Pick list order: vaccines, then medicines; "to confirm" items are still shown (with the badge); inactive and tasks are left out. */
export const pickable = (items: CatalogueItem[]): CatalogueItem[] => items.filter((i) => i.active && i.kind !== "management").sort((a, b) => (a.kind === b.kind ? norm(a.name).localeCompare(norm(b.name)) : a.kind === "vaccine" ? -1 : 1));

/** Search by name, other spelling, purpose or brand. */
export function searchItems(items: CatalogueItem[], q: string): CatalogueItem[] {
  const k = norm(q);
  if (!k) return items;
  return items.filter((i) => [i.name, i.purpose, i.brand, ...i.aliases.map((a) => a.alias)].some((t) => norm(t).includes(k)));
}

/** A one-line summary of an item for cards and pickers. */
export const itemSummary = (i: Pick<CatalogueItem, "purpose" | "route" | "brand">): string =>
  [i.purpose, i.route ? routeLabel(i.route).toLowerCase() : null, i.brand ? `brand ${i.brand}` : null].filter(Boolean).join(" · ");
