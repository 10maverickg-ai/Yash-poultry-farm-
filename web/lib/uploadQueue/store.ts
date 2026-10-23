import { pool, withTransaction } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import type { ReaderResponse } from "@/lib/reader";

export type QueueStatus = "waiting" | "reading" | "saved" | "needs_review" | "failed" | "duplicate" | "dismissed";

export interface QueueItem {
  id: number;
  name: string | null;
  photoUrl: string;
  enteredDate: string;
  status: QueueStatus;
  forceDate: string | null;
  pageDate: string | null;
  attempts: number;
  message: string | null;
  technical: string | null;
  detail: Record<string, unknown> | null;
  savedDay: { rows: number; eggs: number; photoUrl: string | null } | null; // for "duplicate"
  createdAt: string;
}

// A queue row stuck in 'reading' longer than this (the page was closed, the
// function was killed) goes back to 'waiting' and is read again.
const STUCK_MINUTES = 10;

const dateStr = (d: unknown) => (d ? String(d).slice(0, 10) : null);

export async function savedDaySummary(date: string): Promise<{ rows: number; eggs: number; photoUrl: string | null } | null> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n, coalesce(sum(eggs_total),0)::int AS eggs, max(source_photo_url) AS photo
       FROM daily_production WHERE farm_code = $1 AND date = $2 AND deleted_at IS NULL`,
    [ACTIVE_FARM, date]
  );
  return rows[0].n > 0 ? { rows: rows[0].n, eggs: rows[0].eggs, photoUrl: rows[0].photo } : null;
}

/** Adds a photo to the queue. A date that already has a saved day (or is already in the queue) is parked as 'duplicate' for the owner to decide. */
export async function enqueue(photoUrl: string, name: string | null, enteredDate: string): Promise<{ id: number; status: QueueStatus }> {
  const saved = await savedDaySummary(enteredDate);
  const { rows: dup } = await pool.query(
    `SELECT 1 FROM upload_queue WHERE farm_code = $1 AND entered_date = $2 AND status IN ('waiting','reading','saved','needs_review') LIMIT 1`,
    [ACTIVE_FARM, enteredDate]
  );
  const duplicate = !!saved || dup.length > 0;
  const message = saved
    ? `${enteredDate} already has ${saved.rows} saved flock rows (${saved.eggs.toLocaleString("en-IN")} eggs).`
    : dup.length > 0
      ? `Another photo for ${enteredDate} is already in the queue.`
      : null;
  const { rows } = await pool.query(
    `INSERT INTO upload_queue (farm_code, original_name, photo_url, entered_date, status, message)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, status`,
    [ACTIVE_FARM, name, photoUrl, enteredDate, duplicate ? "duplicate" : "waiting", message]
  );
  return { id: Number(rows[0].id), status: rows[0].status };
}

/** Takes the oldest waiting photo (date order) and marks it 'reading'. Returns null when nothing is waiting. */
export async function claimNext(): Promise<{ id: number; photoUrl: string; enteredDate: string; forceDate: string | null; replaceOk: boolean } | null> {
  return withTransaction(async (client) => {
    await client.query(
      `UPDATE upload_queue SET status = 'waiting', message = 'Reading was interrupted; trying again.'
        WHERE farm_code = $1 AND status = 'reading' AND started_at < now() - ($2 || ' minutes')::interval`,
      [ACTIVE_FARM, String(STUCK_MINUTES)]
    );
    const { rows } = await client.query(
      `SELECT id, photo_url, entered_date, force_date, replace_ok FROM upload_queue
        WHERE farm_code = $1 AND status = 'waiting'
        ORDER BY entered_date, id FOR UPDATE SKIP LOCKED LIMIT 1`,
      [ACTIVE_FARM]
    );
    const r = rows[0];
    if (!r) return null;
    await client.query(`UPDATE upload_queue SET status = 'reading', started_at = now(), attempts = attempts + 1, reader = 'old' WHERE id = $1`, [r.id]);
    return { id: Number(r.id), photoUrl: r.photo_url, enteredDate: dateStr(r.entered_date)!, forceDate: dateStr(r.force_date), replaceOk: r.replace_ok };
  });
}

export async function parkAsDuplicate(id: number, message: string): Promise<void> {
  await pool.query(`UPDATE upload_queue SET status = 'duplicate', message = $2 WHERE id = $1`, [id, message]);
}

export async function finish(id: number, res: ReaderResponse): Promise<void> {
  await pool.query(
    `UPDATE upload_queue SET status = $2, message = $3, technical = $4, page_date = $5, detail = $6, finished_at = now() WHERE id = $1`,
    [id, res.status, res.message, res.technical, res.dateMismatch?.page ?? null, res.summary ? JSON.stringify(res.summary) : null]
  );
}

export async function listQueue(): Promise<QueueItem[]> {
  const { rows } = await pool.query(
    `SELECT id, original_name, photo_url, entered_date, status, force_date, page_date, attempts, message, technical, detail, created_at
       FROM upload_queue WHERE farm_code = $1 AND status <> 'dismissed'
      ORDER BY entered_date, id LIMIT 300`,
    [ACTIVE_FARM]
  );
  const items: QueueItem[] = [];
  for (const r of rows) {
    items.push({
      id: Number(r.id), name: r.original_name, photoUrl: r.photo_url, enteredDate: dateStr(r.entered_date)!, status: r.status,
      forceDate: dateStr(r.force_date), pageDate: dateStr(r.page_date), attempts: r.attempts, message: r.message, technical: r.technical,
      detail: r.detail, createdAt: String(r.created_at),
      savedDay: r.status === "duplicate" ? await savedDaySummary(dateStr(r.entered_date)!) : null,
    });
  }
  return items;
}

export async function setStatus(id: number, patch: { status: QueueStatus; replaceOk?: boolean; forceDate?: string | null; message?: string | null }): Promise<void> {
  await pool.query(
    `UPDATE upload_queue SET status = $2,
            replace_ok = COALESCE($3, replace_ok), force_date = COALESCE($4::date, force_date), message = $5
      WHERE id = $1 AND farm_code = $6`,
    [id, patch.status, patch.replaceOk ?? null, patch.forceDate ?? null, patch.message ?? null, ACTIVE_FARM]
  );
}
