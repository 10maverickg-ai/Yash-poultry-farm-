import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { routeLabel } from "./catalogue";
import { buildPlan, type BatchPlanSteps, type TemplateRow } from "./chickPlan";

type Db = Pick<PoolClient, "query">;
const D = (v: unknown) => String(v).slice(0, 10);

export async function listTemplate(db: Db = pool): Promise<TemplateRow[]> {
  const { rows } = await db.query(
    `SELECT t.id, t.day_from, t.day_to, t.catalogue_id, t.note, t.sort_order, c.name, c.kind, c.disease_or_purpose, c.needs_confirmation
       FROM vaccination_schedule_template t JOIN medicine_catalogue c ON c.id = t.catalogue_id
      WHERE t.farm_code = $1 AND t.active ORDER BY t.day_from, t.sort_order, t.id`,
    [ACTIVE_FARM]
  );
  return rows.map((r) => ({ id: Number(r.id), dayFrom: Number(r.day_from), dayTo: r.day_to == null ? null : Number(r.day_to), catalogueId: Number(r.catalogue_id), name: String(r.name), kind: r.kind, purpose: (r.disease_or_purpose as string) ?? null, note: (r.note as string) ?? null, needsConfirmation: Boolean(r.needs_confirmation), sort: Number(r.sort_order) }));
}

export interface StoredStep { id: number; batchId: number; templateId: number; name: string; kind: string; due: string; windowEnd: string | null; givenDate: string | null; note: string | null; dayFrom: number; dayTo: number | null; needsConfirmation: boolean; purpose: string | null }

/** The generated plan rows of every chick batch (steps made from the template). */
export async function listPlanSteps(db: Db = pool): Promise<StoredStep[]> {
  const { rows } = await db.query(
    `SELECT v.id, v.chick_batch_id, v.template_id, v.due_date, v.window_end, v.given_date, v.note, c.name, c.kind, c.needs_confirmation, c.disease_or_purpose, t.day_from, t.day_to, t.sort_order
       FROM vaccination_schedule v JOIN medicine_catalogue c ON c.id = v.catalogue_id JOIN vaccination_schedule_template t ON t.id = v.template_id
      WHERE v.farm_code = $1 AND v.chick_batch_id IS NOT NULL AND v.template_id IS NOT NULL ORDER BY v.chick_batch_id, t.day_from, t.sort_order, v.id`,
    [ACTIVE_FARM]
  );
  return rows.map((r) => ({ id: Number(r.id), batchId: Number(r.chick_batch_id), templateId: Number(r.template_id), name: String(r.name), kind: String(r.kind), due: D(r.due_date), windowEnd: r.window_end ? D(r.window_end) : null, givenDate: r.given_date ? D(r.given_date) : null, note: (r.note as string) ?? null, dayFrom: Number(r.day_from), dayTo: r.day_to == null ? null : Number(r.day_to), needsConfirmation: Boolean(r.needs_confirmation), purpose: (r.disease_or_purpose as string) ?? null }));
}

export async function chickBatchesForPlan(): Promise<{ id: number; arrival: string; count: number; status: string; flockLabel: string | null }[]> {
  const { rows } = await pool.query(
    `SELECT b.id, b.arrival_date, b.starting_count, b.status, f.display_label FROM chick_batches b LEFT JOIN flocks f ON f.flock_internal_id = b.resulting_flock_id WHERE b.farm_code = $1 ORDER BY b.arrival_date DESC`,
    [ACTIVE_FARM]
  );
  return rows.map((r) => ({ id: Number(r.id), arrival: D(r.arrival_date), count: Number(r.starting_count), status: String(r.status), flockLabel: (r.display_label as string) ?? null }));
}

/** Makes the plan for one batch from its arrival date. Steps already there are left alone (nothing is added twice). Returns how many steps were added. */
export async function createPlanForBatch(db: Db, batchId: number): Promise<number> {
  const b = await db.query(`SELECT arrival_date FROM chick_batches WHERE id = $1 AND farm_code = $2`, [batchId, ACTIVE_FARM]);
  if (!b.rows[0]) return 0;
  const [template, routes] = await Promise.all([listTemplate(db), db.query(`SELECT id, route FROM medicine_catalogue WHERE farm_code = $1`, [ACTIVE_FARM])]);
  const route = new Map(routes.rows.map((r) => [Number(r.id), (r.route as string) ?? null]));
  let added = 0;
  for (const s of buildPlan(template, D(b.rows[0].arrival_date))) {
    const res = await db.query(
      `INSERT INTO vaccination_schedule (farm_code, chick_batch_id, vaccine, due_date, window_end, route, note, catalogue_id, template_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (chick_batch_id, template_id) WHERE template_id IS NOT NULL AND chick_batch_id IS NOT NULL DO NOTHING`,
      [ACTIVE_FARM, batchId, s.name, s.due, s.windowEnd, routeLabel(route.get(s.catalogueId)) || null, s.note, s.catalogueId, s.templateId]
    );
    added += res.rowCount ?? 0;
  }
  return added;
}

export async function planAlertsInput(): Promise<BatchPlanSteps[]> {
  const [batches, steps] = await Promise.all([chickBatchesForPlan(), listPlanSteps()]);
  return batches.map((b) => ({ id: b.id, arrival: b.arrival, steps: steps.filter((s) => s.batchId === b.id).map((s) => ({ name: s.name, due: s.due, windowEnd: s.windowEnd, givenDate: s.givenDate })) }));
}

export async function setStepGiven(id: number, given: string | null): Promise<boolean> {
  const { rowCount } = await pool.query(`UPDATE vaccination_schedule SET given_date = $2 WHERE id = $1 AND farm_code = $3 AND template_id IS NOT NULL`, [id, given, ACTIVE_FARM]);
  return (rowCount ?? 0) > 0;
}
