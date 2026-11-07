"use server";

import { withTransaction } from "@/lib/db";
import { validateItem, validateAlias } from "@/lib/medicines/catalogue";
import { addAlias, createItem, deleteItemIfUnused, isClash, listCatalogue, removeAlias, setActive, setConfirmed, updateItem } from "@/lib/medicines/catalogueStore";

export interface ItemState { ok: boolean; message: string; deleted?: boolean }
const STR = (f: FormData, k: string) => (typeof f.get(k) === "string" ? (f.get(k) as string) : "");
const fields = (f: FormData) => ({ name: STR(f, "name"), kind: STR(f, "kind"), purpose: STR(f, "purpose"), route: STR(f, "route"), dose: STR(f, "dose"), brand: STR(f, "brand"), unit: STR(f, "unit"), note: STR(f, "note") });
const FAILED = "That could not be saved just now. Nothing on your screen was lost; try again in a moment.";

// A new list item. Typed in by hand it is marked "to confirm" unless the owner says he has checked it.
export async function addCatalogueItem(_prev: ItemState | null, formData: FormData): Promise<ItemState> {
  try {
    const items = await listCatalogue();
    const v = validateItem(fields(formData), items);
    if (!v.ok) return { ok: false, message: v.errors.join(" ") };
    const checked = STR(formData, "checked") === "yes";
    await withTransaction((c) => createItem(c, v.item, !checked));
    return { ok: true, message: `Added “${v.item.name}” to the list${checked ? "" : " (marked “to confirm” until you check it)"}.` };
  } catch (e) {
    return { ok: false, message: isClash(e) ? "That name is already in the list." : FAILED };
  }
}

export async function saveCatalogueItem(id: number, _prev: ItemState | null, formData: FormData): Promise<ItemState> {
  try {
    const items = await listCatalogue();
    const self = items.find((i) => i.id === id);
    if (!self) return { ok: false, message: "That item is no longer in the list." };
    const f = fields(formData);
    // the type cannot change once register lines use the item (the lines keep the type they were saved with)
    if (self.used > 0) f.kind = self.kind;
    const v = validateItem(f, items, id);
    if (!v.ok) return { ok: false, message: v.errors.join(" ") };
    await updateItem(id, v.item);
    await setConfirmed(id, STR(formData, "still_to_confirm") !== "yes");
    return { ok: true, message: "Saved." };
  } catch (e) {
    return { ok: false, message: isClash(e) ? "That name is already in the list." : FAILED };
  }
}

/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
export async function confirmCatalogueItem(id: number, _prev: ItemState | null, _formData: FormData): Promise<ItemState> {
  try {
    await setConfirmed(id, true);
    return { ok: true, message: "Marked as confirmed." };
  } catch {
    return { ok: false, message: FAILED };
  }
}

/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
export async function setCatalogueActive(id: number, active: boolean, _prev: ItemState | null, _formData: FormData): Promise<ItemState> {
  try {
    await setActive(id, active);
    return { ok: true, message: active ? "It is in the pick list again." : "It no longer shows in the pick list. Old lines keep their name." };
  } catch {
    return { ok: false, message: FAILED };
  }
}

export async function deleteCatalogueItem(id: number, _prev: ItemState | null, formData: FormData): Promise<ItemState> {
  if (STR(formData, "confirm") !== "yes") return { ok: false, message: "Tick “Yes, remove it from the list” first." };
  try {
    const ok = await deleteItemIfUnused(id);
    return ok ? { ok: true, deleted: true, message: "Removed from the list." } : { ok: false, message: "It is used by register lines or the chick plan, so it cannot be removed. Take it out of the pick list instead." };
  } catch {
    return { ok: false, message: FAILED };
  }
}

export async function addAliasAction(id: number, _prev: ItemState | null, formData: FormData): Promise<ItemState> {
  try {
    const items = await listCatalogue();
    if (!items.some((i) => i.id === id)) return { ok: false, message: "That item is no longer in the list." };
    const v = validateAlias(STR(formData, "alias"), items, id);
    if (!v.ok) return { ok: false, message: v.error };
    await withTransaction((c) => addAlias(c, id, v.alias));
    return { ok: true, message: `“${v.alias}” now means this item.` };
  } catch (e) {
    return { ok: false, message: isClash(e) ? "That spelling already means an item in the list." : FAILED };
  }
}

/* eslint-disable-next-line @typescript-eslint/no-unused-vars */
export async function removeAliasAction(aliasId: number, _prev: ItemState | null, _formData: FormData): Promise<ItemState> {
  try {
    await removeAlias(aliasId);
    return { ok: true, message: "That spelling was removed." };
  } catch {
    return { ok: false, message: FAILED };
  }
}

