import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { dupKey, type LineInput, type LineRow, type Kind, type ScheduleItem, type Scope } from "./lines";

const D = (v: unknown) => String(v).slice(0, 10);
const n = (v: unknown) => (v == null ? null : Number(v));

const SELECT = `SELECT m.id, m.date, m.kind, m.item, m.scope, m.flock_internal_id, m.shed_code, m.quantity, m.unit, m.amount_inr, m.supplier, m.note, m.source_photo_url, m.source_tag, f.display_label
                  FROM medicine_lines m LEFT JOIN flocks f ON f.flock_internal_id = m.flock_internal_id WHERE m.farm_code = $1`;

function toRow(r: Record<string, unknown>): LineRow {
  const scope = r.scope as Scope;
  return {
    id: Number(r.id),
    date: D(r.date),
    kind: r.kind as Kind,
    item: String(r.item),
    scope,
    flockId: (r.flock_internal_id as string) ?? null,
    shedCode: (r.shed_code as string) ?? null,
    quantity: n(r.quantity),
    unit: (r.unit as string) ?? null,
    cost: n(r.amount_inr),
    supplier: (r.supplier as string) ?? null,
    note: (r.note as string) ?? null,
    photoUrl: (r.source_photo_url as string) ?? null,
    sourceTag: String(r.source_tag),
    targetLabel: scope === "flock" ? String(r.display_label ?? "a flock") : scope === "shed" ? String(r.shed_code) : "Whole farm",
  };
}

export async function listLines(): Promise<LineRow[]> {
  const { rows } = await pool.query(`${SELECT} ORDER BY m.date DESC, m.id DESC`, [ACTIVE_FARM]);
  return rows.map(toRow);
}
export async function getLine(id: number): Promise<LineRow | null> {
  const { rows } = await pool.query(`${SELECT} AND m.id = $2`, [ACTIVE_FARM, id]);
  return rows[0] ? toRow(rows[0]) : null;
}

export async function listTargets(): Promise<{ flocks: { id: string; label: string; active: boolean }[]; sheds: string[] }> {
  const [f, s] = await Promise.all([
    pool.query(`SELECT flock_internal_id, display_label, status FROM flocks WHERE farm_code = $1 ORDER BY (status = 'active') DESC, display_label`, [ACTIVE_FARM]),
    pool.query(`SELECT shed_code FROM sheds WHERE farm_code = $1 ORDER BY shed_code`, [ACTIVE_FARM]),
  ]);
  return { flocks: f.rows.map((r) => ({ id: r.flock_internal_id, label: r.display_label, active: r.status === "active" })), sheds: s.rows.map((r) => r.shed_code) };
}

/** Names used before (for the suggestion list when typing a name or a supplier). */
export async function listSuggestions(): Promise<{ items: string[]; suppliers: string[] }> {
  const { rows } = await pool.query(`SELECT item, supplier, count(*) c FROM medicine_lines WHERE farm_code = $1 GROUP BY item, supplier ORDER BY c DESC LIMIT 200`, [ACTIVE_FARM]);
  return { items: [...new Set(rows.map((r) => r.item as string))].slice(0, 60), suppliers: [...new Set(rows.map((r) => r.supplier as string).filter(Boolean))].slice(0, 30) };
}

export async function insertLine(db: Pick<PoolClient, "query">, l: LineInput, photoUrl: string | null, tag: string): Promise<number> {
  const { rows } = await db.query(
    `INSERT INTO medicine_lines (farm_code, date, kind, item, scope, flock_internal_id, shed_code, quantity, unit, amount_inr, supplier, note, source_photo_url, source_tag)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [ACTIVE_FARM, l.date, l.kind, l.item, l.scope, l.flockId, l.shedCode, l.quantity, l.unit, l.cost, l.supplier, l.note, photoUrl, tag]
  );
  return Number(rows[0].id);
}
export async function updateLine(id: number, l: LineInput, photoUrl: string | null | undefined): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE medicine_lines SET date=$3, kind=$4, item=$5, scope=$6, flock_internal_id=$7, shed_code=$8, quantity=$9, unit=$10, amount_inr=$11, supplier=$12, note=$13,
            source_photo_url = COALESCE($14, source_photo_url), updated_at = now()
      WHERE id = $1 AND farm_code = $2`,
    [id, ACTIVE_FARM, l.date, l.kind, l.item, l.scope, l.flockId, l.shedCode, l.quantity, l.unit, l.cost, l.supplier, l.note, photoUrl ?? null]
  );
  return (rowCount ?? 0) > 0;
}
export async function deleteLine(id: number): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM medicine_lines WHERE id = $1 AND farm_code = $2`, [id, ACTIVE_FARM]);
  return (rowCount ?? 0) > 0;
}
export async function existingKeys(): Promise<Set<string>> {
  const rows = await listLines();
  return new Set(rows.map((r) => dupKey(r)));
}

/** "None this month" for medicines (monthly_input_status key 'medicines'), and taking it back. */
export async function monthStatus(month: string): Promise<"none" | "confirmed" | null> {
  const { rows } = await pool.query(`SELECT status FROM monthly_input_status WHERE farm_code = $1 AND month = $2 AND input_key = 'medicines'`, [ACTIVE_FARM, month]);
  return (rows[0]?.status as "none" | "confirmed") ?? null;
}
export async function setMonthNone(month: string, none: boolean): Promise<void> {
  if (none) await pool.query(`INSERT INTO monthly_input_status (farm_code, month, input_key, status) VALUES ($1,$2,'medicines','none') ON CONFLICT (farm_code, month, input_key) DO UPDATE SET status = 'none'`, [ACTIVE_FARM, month]);
  else await pool.query(`DELETE FROM monthly_input_status WHERE farm_code = $1 AND month = $2 AND input_key = 'medicines'`, [ACTIVE_FARM, month]);
}

export async function listSchedule(): Promise<ScheduleItem[]> {
  const { rows } = await pool.query(
    `SELECT v.id, v.vaccine, v.due_date, v.given_date, v.route, v.note, f.display_label, b.arrival_date
       FROM vaccination_schedule v LEFT JOIN flocks f ON f.flock_internal_id = v.flock_internal_id LEFT JOIN chick_batches b ON b.id = v.chick_batch_id
      WHERE v.farm_code = $1 ORDER BY v.due_date`,
    [ACTIVE_FARM]
  );
  return rows.map((v) => ({ id: Number(v.id), vaccine: v.vaccine, dueDate: D(v.due_date), givenDate: v.given_date ? D(v.given_date) : null, target: v.display_label ? `flock ${v.display_label}` : `chick batch ${D(v.arrival_date)}`, route: v.route, note: v.note }));
}
