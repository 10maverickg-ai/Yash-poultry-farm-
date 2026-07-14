import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";

export interface ChickBatch {
  id: number;
  date: string;
  shed_code: string;
  total_birds: number | null;
  source_hatchery: string | null;
  notes: string | null;
  flagged: boolean;
  flag_reason: string | null;
}

export async function listChickBatches(limit = 60): Promise<ChickBatch[]> {
  const { rows } = await pool.query(
    `SELECT id, date, shed_code, total_birds, source_hatchery, notes, flagged, flag_reason
       FROM chick_batch_log
      WHERE farm_code = $1
      ORDER BY date DESC, id DESC
      LIMIT $2`,
    [ACTIVE_FARM, limit]
  );
  return rows;
}
