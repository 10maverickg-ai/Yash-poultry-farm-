import type { PoolClient } from "pg";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { matchOldLines } from "./catalogueStore";
import { lineKey } from "./import";
import { type LineInput, type LineRow, type Kind, type ScheduleItem, type Scope } from "./lines";

const D = (v: unknown) => String(v).slice(0, 10);
const n = (v: unknown) => (v == null ? null : Number(v));

const SELECT = `SELECT m.id, m.date, m.kind, m.item, m.scope, m.flock_internal_id, m.shed_code, m.quantity, m.unit, m.amount_inr, m.supplier, m.note, m.source_photo_url, m.source_tag, f.display_label,
                       m.catalogue_id, c.name AS list_name, m.entry_group, m.cost_total_inr, m.quantity_total, m.split_basis
                  FROM medicine_lines m LEFT JOIN flocks f ON f.flock_internal_id = m.flock_internal_id LEFT JOIN medicine_catalogue c ON c.id = m.catalogue_id WHERE m.farm_code = $1`;

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
    catalogueId: r.catalogue_id == null ? null : Number(r.catalogue_id),
    listName: (r.list_name as string) ?? null,
    entryGroup: (r.entry_group as string) ?? null,
    costTotal: n(r.cost_total_inr),
    quantityTotal: n(r.quantity_total),
    splitBasis: (r.split_basis as "birds" | "equal") ?? null,
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
    `INSERT INTO medicine_lines (farm_code, date, kind, item, scope, flock_internal_id, shed_code, quantity, unit, amount_inr, supplier, note, source_photo_url, source_tag,
                                 catalogue_id, entry_group, cost_total_inr, quantity_total, split_basis)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
    [ACTIVE_FARM, l.date, l.kind, l.item, l.scope, l.flockId, l.shedCode, l.quantity, l.unit, l.cost, l.supplier, l.note, photoUrl, tag,
     l.catalogueId ?? null, l.entryGroup ?? null, l.costTotal ?? null, l.quantityTotal ?? null, l.splitBasis ?? null]
  );
  return Number(rows[0].id);
}
export async function updateLine(id: number, l: LineInput, photoUrl: string | null | undefined): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE medicine_lines SET date=$3, kind=$4, item=$5, scope=$6, flock_internal_id=$7, shed_code=$8, quantity=$9, unit=$10, amount_inr=$11, supplier=$12, note=$13,
            source_photo_url = COALESCE($14, source_photo_url), catalogue_id = $15, updated_at = now()
      WHERE id = $1 AND farm_code = $2`,
    [id, ACTIVE_FARM, l.date, l.kind, l.item, l.scope, l.flockId, l.shedCode, l.quantity, l.unit, l.cost, l.supplier, l.note, photoUrl ?? null, l.catalogueId ?? null]
  );
  return (rowCount ?? 0) > 0;
}
export async function deleteLine(id: number): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM medicine_lines WHERE id = $1 AND farm_code = $2`, [id, ACTIVE_FARM]);
  return (rowCount ?? 0) > 0;
}
/** lineKey() of every line already in the register (date + list item + flock), so an import never doubles a line. */
export async function existingKeys(): Promise<Set<string>> {
  const rows = await listLines();
  return new Set(rows.map((r) => lineKey(r.date, r.catalogueId, r.item, r.flockId)));
}

/** Birds in each flock on each date (the last register figure on or before it, else the flock's current count). Keyed "date|flockId". */
export async function birdsForDates(dates: string[], flockIds: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (dates.length === 0 || flockIds.length === 0) return out;
  const { rows } = await pool.query(
    `SELECT d.date::text AS date, f.id::text AS flock,
            COALESCE((SELECT p.bird_population FROM daily_production p WHERE p.flock_internal_id = f.id AND p.date <= d.date AND p.deleted_at IS NULL AND p.bird_population IS NOT NULL ORDER BY p.date DESC LIMIT 1),
                     (SELECT fl.current_bird_count FROM flocks fl WHERE fl.flock_internal_id = f.id)) AS birds
       FROM unnest($1::date[]) AS d(date) CROSS JOIN unnest($2::uuid[]) AS f(id)`,
    [dates, flockIds]
  );
  for (const r of rows) out.set(`${r.date}|${r.flock}`, r.birds == null ? null : Number(r.birds));
  return out;
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

// ---- V14: entries for several flocks, birds, unmatched lines -----------------------------------------------------------------------

/** Birds in each flock on a date: the last register figure on or before that date, else the flock's current count, else null. */
export async function birdsOn(date: string, flockIds: string[]): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>(flockIds.map((id) => [id, null]));
  if (flockIds.length === 0) return out;
  const [dp, fl] = await Promise.all([
    pool.query(
      `SELECT DISTINCT ON (flock_internal_id) flock_internal_id, bird_population FROM daily_production
        WHERE farm_code = $1 AND flock_internal_id = ANY($2::uuid[]) AND date <= $3::date AND deleted_at IS NULL AND bird_population IS NOT NULL
        ORDER BY flock_internal_id, date DESC`,
      [ACTIVE_FARM, flockIds, date]
    ),
    pool.query(`SELECT flock_internal_id, current_bird_count FROM flocks WHERE farm_code = $1 AND flock_internal_id = ANY($2::uuid[])`, [ACTIVE_FARM, flockIds]),
  ]);
  for (const r of fl.rows) out.set(r.flock_internal_id, r.current_bird_count == null ? null : Number(r.current_bird_count));
  for (const r of dp.rows) out.set(r.flock_internal_id, Number(r.bird_population));
  return out;
}

/** The flocks the entry form offers: active flocks, with the latest known bird count and their group (main / young). */
export async function listEntryFlocks(): Promise<{ id: string; label: string; birds: number | null; segment: "main" | "young" | null }[]> {
  const { rows } = await pool.query(
    `SELECT f.flock_internal_id, f.display_label, f.segment, f.current_bird_count,
            (SELECT bird_population FROM daily_production d WHERE d.flock_internal_id = f.flock_internal_id AND d.deleted_at IS NULL AND d.bird_population IS NOT NULL ORDER BY d.date DESC LIMIT 1) AS latest
       FROM flocks f WHERE f.farm_code = $1 AND f.status = 'active'`,
    [ACTIVE_FARM]
  );
  return rows
    .map((r) => ({ id: r.flock_internal_id as string, label: r.display_label as string, birds: r.latest != null ? Number(r.latest) : r.current_bird_count != null ? Number(r.current_bird_count) : null, segment: (r.segment as "main" | "young") ?? null }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

/** Old lines whose typed name is not in the list, grouped by what was typed (newest first). */
export async function listUnmatched(): Promise<{ item: string; kind: string; lines: number; cost: number; withoutCost: number; latest: string }[]> {
  await matchOldLines(pool); // a line whose name exactly matches an item or its other spelling is matched by itself; only the rest is listed
  const { rows } = await pool.query(
    `SELECT btrim(item) AS item, kind, count(*)::int AS lines, coalesce(sum(amount_inr),0) AS cost, count(*) FILTER (WHERE amount_inr IS NULL)::int AS no_cost, max(date) AS latest
       FROM medicine_lines WHERE farm_code = $1 AND catalogue_id IS NULL GROUP BY lower(btrim(item)), btrim(item), kind ORDER BY max(date) DESC`,
    [ACTIVE_FARM]
  );
  return rows.map((r) => ({ item: String(r.item), kind: String(r.kind), lines: Number(r.lines), cost: Number(r.cost), withoutCost: Number(r.no_cost), latest: String(r.latest).slice(0, 10) }));
}

/** One-tap match: every unmatched line typed with this name gets the list item (and the item's type, which decides medicine / vaccine cost). */
export async function matchLinesByName(itemText: string, catalogueId: number): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE medicine_lines m SET catalogue_id = c.id, kind = c.kind, updated_at = now()
       FROM medicine_catalogue c
      WHERE c.id = $3 AND c.farm_code = $1 AND c.kind IN ('medicine','vaccine') AND m.farm_code = $1 AND m.catalogue_id IS NULL AND lower(btrim(m.item)) = lower(btrim($2))`,
    [ACTIVE_FARM, itemText, catalogueId]
  );
  return rowCount ?? 0;
}

export async function deleteEntryGroup(group: string): Promise<number> {
  const { rowCount } = await pool.query(`DELETE FROM medicine_lines WHERE entry_group = $1 AND farm_code = $2`, [group, ACTIVE_FARM]);
  return rowCount ?? 0;
}
export async function groupLines(group: string): Promise<LineRow[]> {
  const { rows } = await pool.query(`${SELECT} AND m.entry_group = $2 ORDER BY f.display_label`, [ACTIVE_FARM, group]);
  return rows.map(toRow);
}
