import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { boosterTable, type FlockBoosters, type GivenLine, type LayingFlock, type RuleDef } from "./boosters";

type Db = Pick<PoolClient, "query">;

export async function listRules(db: Db = pool): Promise<RuleDef[]> {
  const { rows } = await db.query(
    `SELECT r.id, r.code, r.label, r.repeat_months, r.main_catalogue_id,
            COALESCE((SELECT array_agg(i.catalogue_id) FROM vaccine_repeat_rule_items i WHERE i.rule_id = r.id), '{}') AS item_ids
       FROM vaccine_repeat_rules r WHERE r.farm_code = $1 AND r.active ORDER BY r.id`,
    [ACTIVE_FARM]
  );
  return rows.map((r) => ({ id: Number(r.id), code: String(r.code), label: String(r.label), repeatMonths: Number(r.repeat_months), mainItemId: r.main_catalogue_id == null ? null : Number(r.main_catalogue_id), itemIds: (r.item_ids as (number | string)[]).map(Number) }));
}

/** Laying flocks: active flocks in the layer stage. */
export async function listLayingFlocks(db: Db = pool): Promise<LayingFlock[]> {
  const { rows } = await db.query(`SELECT flock_internal_id, display_label, current_shed, segment FROM flocks WHERE farm_code = $1 AND status = 'active' AND current_stage = 'layer'`, [ACTIVE_FARM]);
  return rows
    .map((r) => ({ id: r.flock_internal_id as string, label: r.display_label as string, shed: (r.current_shed as string) ?? null, segment: (r.segment as "main" | "young") ?? null }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/** Every register line that may count for some rule (lines of list items that belong to a rule). */
export async function listRuleLines(db: Db = pool): Promise<GivenLine[]> {
  const { rows } = await db.query(
    `SELECT l.scope, l.flock_internal_id, l.shed_code, l.date, l.catalogue_id FROM medicine_lines l
      WHERE l.farm_code = $1 AND l.catalogue_id IN (SELECT i.catalogue_id FROM vaccine_repeat_rule_items i JOIN vaccine_repeat_rules r ON r.id = i.rule_id WHERE r.farm_code = $1 AND r.active)`,
    [ACTIVE_FARM]
  );
  return rows.map((r) => ({ scope: r.scope, flockId: (r.flock_internal_id as string) ?? null, shedCode: (r.shed_code as string) ?? null, date: String(r.date).slice(0, 10), catalogueId: Number(r.catalogue_id) }));
}

export async function loadBoosters(today: string): Promise<{ rules: RuleDef[]; table: FlockBoosters[] }> {
  const [rules, flocks, lines] = await Promise.all([listRules(), listLayingFlocks(), listRuleLines()]);
  return { rules, table: boosterTable(rules, flocks, lines, today) };
}

/** Which rules a list item counts for. */
export async function itemRuleIds(catalogueId: number): Promise<number[]> {
  const { rows } = await pool.query(`SELECT rule_id FROM vaccine_repeat_rule_items WHERE catalogue_id = $1`, [catalogueId]);
  return rows.map((r) => Number(r.rule_id));
}
export async function setItemRules(catalogueId: number, ruleIds: number[]): Promise<void> {
  const rules = await listRules();
  const keep = new Set(ruleIds);
  for (const r of rules) {
    if (r.mainItemId === catalogueId) keep.add(r.id); // a rule's own item always counts for it
    if (keep.has(r.id)) await pool.query(`INSERT INTO vaccine_repeat_rule_items (rule_id, catalogue_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [r.id, catalogueId]);
    else await pool.query(`DELETE FROM vaccine_repeat_rule_items WHERE rule_id = $1 AND catalogue_id = $2`, [r.id, catalogueId]);
  }
}

// ---- what each flock is on ----------------------------------------------------------------------------------------------------------

export interface GivenRow { id: number; date: string; name: string; kind: string; quantity: number | null; unit: string | null; cost: number | null; scope: string; catalogued: boolean }

/** The register lines of every flock, newest first. Lines for the whole farm or a shed (older entries) are included for the flocks they cover. */
export async function listGivenByFlock(flocks: { id: string; shed: string | null }[], db: Db = pool): Promise<Map<string, GivenRow[]>> {
  const { rows } = await db.query(
    `SELECT l.id, l.date, l.item, c.name AS list_name, l.kind, l.quantity, l.unit, l.amount_inr, l.scope, l.flock_internal_id, l.shed_code, l.catalogue_id
       FROM medicine_lines l LEFT JOIN medicine_catalogue c ON c.id = l.catalogue_id WHERE l.farm_code = $1 ORDER BY l.date DESC, l.id DESC`,
    [ACTIVE_FARM]
  );
  const out = new Map<string, GivenRow[]>(flocks.map((f) => [f.id, []]));
  for (const r of rows) {
    const row: GivenRow = { id: Number(r.id), date: String(r.date).slice(0, 10), name: (r.list_name as string) ?? String(r.item), kind: String(r.kind), quantity: r.quantity == null ? null : Number(r.quantity), unit: (r.unit as string) ?? null, cost: r.amount_inr == null ? null : Number(r.amount_inr), scope: String(r.scope), catalogued: r.catalogue_id != null };
    for (const f of flocks) {
      if (r.scope === "farm" || (r.scope === "flock" && r.flock_internal_id === f.id) || (r.scope === "shed" && r.shed_code != null && r.shed_code === f.shed)) out.get(f.id)!.push(row);
    }
  }
  return out;
}

export interface FlockMedicineView { flock: { id: string; label: string; shed: string | null; segment: "main" | "young" | null; laying: boolean }; given: GivenRow[]; cells: import("./boosters").BoosterCell[] }

export async function loadFlockMedicines(today: string, onlyFlockId?: string): Promise<{ rules: RuleDef[]; views: FlockMedicineView[] }> {
  const [rules, laying, lines, fl] = await Promise.all([
    listRules(),
    listLayingFlocks(),
    listRuleLines(),
    pool.query(`SELECT flock_internal_id, display_label, current_shed, segment, current_stage FROM flocks WHERE farm_code = $1 AND status = 'active'`, [ACTIVE_FARM]),
  ]);
  const all = fl.rows
    .map((r) => ({ id: r.flock_internal_id as string, label: r.display_label as string, shed: (r.current_shed as string) ?? null, segment: (r.segment as "main" | "young") ?? null, laying: r.current_stage === "layer" }))
    .filter((f) => !onlyFlockId || f.id === onlyFlockId)
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const given = await listGivenByFlock(all);
  const table = boosterTable(rules, laying, lines, today);
  return { rules, views: all.map((flock) => ({ flock, given: given.get(flock.id) ?? [], cells: table.find((t) => t.flock.id === flock.id)?.cells ?? [] })) };
}
