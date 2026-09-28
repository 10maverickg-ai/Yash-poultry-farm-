import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { compareLabels } from "@/lib/naturalSort";

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
      ORDER BY status, placement_date DESC NULLS LAST`,
    [ACTIVE_FARM]
  );
  // The SQL ORDER BY groups by status and recency; ties within a group
  // (most often "same status, same placement_date" for a batch of flocks
  // placed together) are broken here by natural label order instead of a
  // plain string sort, which is what was putting BAB-10 between BAB-1 and
  // BAB-2.
  return rows.sort((a, b) => {
    if (a.status !== b.status) return a.status < b.status ? -1 : 1;
    if (a.placement_date !== b.placement_date) {
      if (a.placement_date === null) return 1;
      if (b.placement_date === null) return -1;
      return a.placement_date < b.placement_date ? 1 : -1;
    }
    return compareLabels(a.display_label, b.display_label);
  });
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
