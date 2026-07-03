import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";

export type FlockStage = "chick" | "grower" | "layer";
export type FlockStatus = "active" | "depleted";

export interface Flock {
  flock_internal_id: string;
  farm_code: string;
  display_label: string;
  breed: string | null;
  placement_date: string | null;
  source_hatchery: string | null;
  hatchery_bill_photo_url: string | null;
  initial_chick_count: number | null;
  current_bird_count: number | null;
  current_shed: string | null;
  current_stage: FlockStage | null;
  stage_transition_dates: Record<string, string> | null;
  status: FlockStatus;
  depletion_date: string | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface LabelHistoryRow {
  id: number;
  flock_internal_id: string;
  display_label: string;
  effective_from: string;
  effective_to: string | null;
}

export async function listFlocks(): Promise<Flock[]> {
  const { rows } = await pool.query<Flock>(
    `SELECT * FROM flocks
      WHERE farm_code = $1
      ORDER BY status, placement_date DESC NULLS LAST, display_label`,
    [ACTIVE_FARM]
  );
  return rows;
}

export async function getFlock(id: string): Promise<Flock | null> {
  const { rows } = await pool.query<Flock>(
    `SELECT * FROM flocks WHERE flock_internal_id = $1 AND farm_code = $2`,
    [id, ACTIVE_FARM]
  );
  return rows[0] ?? null;
}

export async function getLabelHistory(
  flockId: string
): Promise<LabelHistoryRow[]> {
  const { rows } = await pool.query<LabelHistoryRow>(
    `SELECT * FROM flock_label_history
      WHERE flock_internal_id = $1
      ORDER BY effective_from`,
    [flockId]
  );
  return rows;
}

export interface Shed {
  farm_code: string;
  shed_code: string;
  shed_type: FlockStage | null;
  max_capacity: number | null;
  notes: string | null;
}

export async function listSheds(): Promise<Shed[]> {
  const { rows } = await pool.query<Shed>(
    `SELECT * FROM sheds WHERE farm_code = $1 ORDER BY shed_code`,
    [ACTIVE_FARM]
  );
  return rows;
}
