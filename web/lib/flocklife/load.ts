import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";

export interface StageEvent { id: number; stage: string; from: string; to: string | null; note: string | null }
export interface MovementRow { id: number; date: string; change: number; type: string; buyer: string | null; price: number | null; reason: string | null; counterpart: string | null }
export interface MoultRow { id: number; flockId: string; flockName: string; start: string; end: string | null; confirmed: boolean; note: string | null; birds: number | null; feedByDay: { date: string; bags: number | null }[] }

export async function getStageHistory(flockId: string): Promise<StageEvent[]> {
  const { rows } = await pool.query(`SELECT id, stage, from_date, to_date, note FROM flock_stage_history WHERE flock_internal_id = $1 ORDER BY from_date, id`, [flockId]);
  return rows.map((r) => ({ id: Number(r.id), stage: r.stage, from: String(r.from_date).slice(0, 10), to: r.to_date ? String(r.to_date).slice(0, 10) : null, note: r.note }));
}

export async function getFlockMovements(flockId: string): Promise<MovementRow[]> {
  const { rows } = await pool.query(
    `SELECT m.id, m.date, m.birds_change, m.movement_type, m.buyer, m.price_per_bird, m.reason, c.display_label AS counterpart
       FROM flock_movements m LEFT JOIN flocks c ON c.flock_internal_id = m.counterpart_flock_id
      WHERE m.flock_internal_id = $1 ORDER BY m.date, m.id`,
    [flockId]
  );
  return rows.map((r) => ({ id: Number(r.id), date: r.date, change: r.birds_change, type: r.movement_type, buyer: r.buyer, price: r.price_per_bird != null ? Number(r.price_per_bird) : null, reason: r.reason, counterpart: r.counterpart }));
}

/** Other flocks that have carried the same display label (labels are reused; flocks are told apart by their id). */
export async function sameLabelFlocks(flockId: string, label: string): Promise<{ id: string; name: string; from: string; to: string | null }[]> {
  const { rows } = await pool.query(
    `SELECT h.flock_internal_id AS id, f.display_label AS name, h.effective_from, h.effective_to
       FROM flock_label_history h JOIN flocks f USING (flock_internal_id)
      WHERE h.display_label = $1 AND h.flock_internal_id <> $2 ORDER BY h.effective_from`,
    [label, flockId]
  );
  return rows.map((r) => ({ id: r.id, name: r.name, from: String(r.effective_from).slice(0, 10), to: r.effective_to ? String(r.effective_to).slice(0, 10) : null }));
}

export async function listMoulting(): Promise<MoultRow[]> {
  const { rows } = await pool.query(
    `SELECT m.id, m.flock_internal_id, f.display_label, m.start_date, m.end_date, m.confirmed_by_owner, m.note,
            (SELECT bird_population FROM daily_production d WHERE d.flock_internal_id = m.flock_internal_id AND d.deleted_at IS NULL AND d.date <= COALESCE(m.end_date, CURRENT_DATE) ORDER BY d.date DESC LIMIT 1) AS birds
       FROM moulting_periods m JOIN flocks f USING (flock_internal_id)
      WHERE f.farm_code = $1 ORDER BY m.start_date DESC`,
    [ACTIVE_FARM]
  );
  const out: MoultRow[] = [];
  for (const r of rows) {
    const feed = await pool.query(
      `SELECT date, feed_bags FROM daily_production
        WHERE flock_internal_id = $1 AND deleted_at IS NULL AND date >= $2 AND date <= COALESCE($3::date, $2::date + 30) ORDER BY date`,
      [r.flock_internal_id, r.start_date, r.end_date]
    );
    out.push({
      id: Number(r.id), flockId: r.flock_internal_id, flockName: r.display_label,
      start: String(r.start_date).slice(0, 10), end: r.end_date ? String(r.end_date).slice(0, 10) : null,
      confirmed: r.confirmed_by_owner, note: r.note, birds: r.birds,
      feedByDay: feed.rows.map((f) => ({ date: f.date, bags: f.feed_bags })),
    });
  }
  return out;
}

export interface BatchRow {
  id: number; arrival: string; source: string | null; start: number; side: string | null; status: string;
  movedToLayer: string | null; anil: number; note: string | null; flockId: string | null; flockName: string | null;
}
export async function listBatches(): Promise<BatchRow[]> {
  const { rows } = await pool.query(
    `SELECT b.id, b.arrival_date, b.source, b.starting_count, b.shed_side, b.status, b.moved_to_layer_date, b.to_anil_farm_count, b.note,
            b.resulting_flock_id, f.display_label
       FROM chick_batches b LEFT JOIN flocks f ON f.flock_internal_id = b.resulting_flock_id
      WHERE b.farm_code = $1 ORDER BY b.arrival_date DESC`,
    [ACTIVE_FARM]
  );
  return rows.map((r) => ({
    id: Number(r.id), arrival: String(r.arrival_date).slice(0, 10), source: r.source, start: r.starting_count, side: r.shed_side, status: r.status,
    movedToLayer: r.moved_to_layer_date ? String(r.moved_to_layer_date).slice(0, 10) : null, anil: r.to_anil_farm_count, note: r.note,
    flockId: r.resulting_flock_id, flockName: r.display_label,
  }));
}

export interface ChickDeathRow { position: number; label: string; from: string; to: string; days: number; deaths: number }
export async function chickDeathsByRow(): Promise<{ rows: ChickDeathRow[]; byDay: { date: string; position: number; label: string; deaths: number }[] }> {
  const [agg, byDay] = await Promise.all([
    pool.query(
      `SELECT row_position, label_as_written, min(date) AS mn, max(date) AS mx, count(*)::int AS days, sum(deaths)::int AS deaths
         FROM chick_daily_mortality WHERE farm_code = $1 GROUP BY 1,2 ORDER BY 1, min(date)`,
      [ACTIVE_FARM]
    ),
    pool.query(`SELECT date, row_position, label_as_written, deaths FROM chick_daily_mortality WHERE farm_code = $1 ORDER BY date, row_position`, [ACTIVE_FARM]),
  ]);
  return {
    rows: agg.rows.map((r) => ({ position: r.row_position, label: r.label_as_written, from: r.mn, to: r.mx, days: r.days, deaths: r.deaths })),
    byDay: byDay.rows.map((r) => ({ date: r.date, position: r.row_position, label: r.label_as_written, deaths: r.deaths })),
  };
}
