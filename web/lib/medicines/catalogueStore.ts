import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import type { CatalogueItem, ItemInput, ItemKind, RouteKey } from "./catalogue";

type Db = Pick<PoolClient, "query">;

const toItem = (r: Record<string, unknown>): CatalogueItem => ({
  id: Number(r.id),
  name: String(r.name),
  kind: r.kind as ItemKind,
  purpose: (r.disease_or_purpose as string) ?? null,
  route: (r.route as RouteKey) ?? null,
  dose: (r.usual_dose_text as string) ?? null,
  brand: (r.brand as string) ?? null,
  unit: (r.default_unit as string) ?? null,
  active: Boolean(r.active),
  needsConfirmation: Boolean(r.needs_confirmation),
  note: (r.note as string) ?? null,
  aliases: [],
  used: Number(r.used ?? 0),
});

/** The whole list with other spellings and how often each item is used. */
export async function listCatalogue(db: Db = pool): Promise<CatalogueItem[]> {
  const [c, a] = await Promise.all([
    db.query(
      `SELECT c.*,
              (SELECT count(*) FROM medicine_lines l WHERE l.catalogue_id = c.id)
            + (SELECT count(*) FROM vaccine_repeat_rule_items r WHERE r.catalogue_id = c.id)
            + (SELECT count(*) FROM vaccine_repeat_rules r WHERE r.main_catalogue_id = c.id) AS used
         FROM medicine_catalogue c WHERE c.farm_code = $1 ORDER BY lower(c.name)`,
      [ACTIVE_FARM]
    ),
    db.query(`SELECT id, catalogue_id, alias FROM medicine_aliases WHERE farm_code = $1 ORDER BY lower(alias)`, [ACTIVE_FARM]),
  ]);
  const items = c.rows.map(toItem);
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const r of a.rows) byId.get(Number(r.catalogue_id))?.aliases.push({ id: Number(r.id), alias: String(r.alias) });
  return items;
}

export async function getItem(id: number): Promise<CatalogueItem | null> {
  return (await listCatalogue()).find((i) => i.id === id) ?? null;
}

/** A unique-name clash that got past the check (two people saving at once) becomes a plain sentence, not an error page. */
export const isClash = (e: unknown): boolean => typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";

export async function createItem(db: Db, i: ItemInput, needsConfirmation: boolean): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO medicine_catalogue (farm_code, name, kind, disease_or_purpose, route, usual_dose_text, brand, default_unit, needs_confirmation, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [ACTIVE_FARM, i.name, i.kind, i.purpose, i.route, i.dose, i.brand, i.unit, needsConfirmation, i.note]
  );
  const id = Number(rows[0].id);
  await matchOldLines(db);
  return id;
}

export async function updateItem(id: number, i: ItemInput): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE medicine_catalogue SET name=$3, kind=$4, disease_or_purpose=$5, route=$6, usual_dose_text=$7, brand=$8, default_unit=$9, note=$10, updated_at=now()
      WHERE id=$1 AND farm_code=$2`,
    [id, ACTIVE_FARM, i.name, i.kind, i.purpose, i.route, i.dose, i.brand, i.unit, i.note]
  );
  await matchOldLines(pool);
  return (rowCount ?? 0) > 0;
}
export async function setConfirmed(id: number, confirmed: boolean): Promise<void> {
  await pool.query(`UPDATE medicine_catalogue SET needs_confirmation = $3, updated_at = now() WHERE id = $1 AND farm_code = $2`, [id, ACTIVE_FARM, !confirmed]);
}
export async function setActive(id: number, active: boolean): Promise<void> {
  await pool.query(`UPDATE medicine_catalogue SET active = $3, updated_at = now() WHERE id = $1 AND farm_code = $2`, [id, ACTIVE_FARM, active]);
}
/** Only an item nothing uses can be deleted; anything else is deactivated. Returns false when it is in use. */
export async function deleteItemIfUnused(id: number): Promise<boolean> {
  const item = await getItem(id);
  if (!item || item.used > 0) return false;
  await pool.query(`DELETE FROM medicine_catalogue WHERE id = $1 AND farm_code = $2`, [id, ACTIVE_FARM]);
  return true;
}
export async function addAlias(db: Db, itemId: number, alias: string): Promise<void> {
  await db.query(`INSERT INTO medicine_aliases (farm_code, catalogue_id, alias) VALUES ($1,$2,$3)`, [ACTIVE_FARM, itemId, alias]);
  await matchOldLines(db);
}
export async function removeAlias(aliasId: number): Promise<void> {
  await pool.query(`DELETE FROM medicine_aliases WHERE id = $1 AND farm_code = $2`, [aliasId, ACTIVE_FARM]);
}

/** Old free-text lines whose name (or other spelling) matches a list item exactly and whose type agrees. Returns how many were matched. */
export async function matchOldLines(db: Db = pool): Promise<number> {
  const a = await db.query(
    `UPDATE medicine_lines m SET catalogue_id = c.id FROM medicine_catalogue c
      WHERE m.catalogue_id IS NULL AND c.farm_code = m.farm_code AND c.kind = m.kind AND lower(btrim(m.item)) = lower(btrim(c.name))`
  );
  const b = await db.query(
    `UPDATE medicine_lines m SET catalogue_id = al.catalogue_id FROM medicine_aliases al JOIN medicine_catalogue c ON c.id = al.catalogue_id
      WHERE m.catalogue_id IS NULL AND al.farm_code = m.farm_code AND c.kind = m.kind AND lower(btrim(m.item)) = lower(btrim(al.alias))`
  );
  return (a.rowCount ?? 0) + (b.rowCount ?? 0);
}
