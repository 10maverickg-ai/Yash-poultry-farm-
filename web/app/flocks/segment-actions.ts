"use server";

import { revalidatePath } from "next/cache";
import { pool, withTransaction } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";

const SEGMENTS = ["main", "young"] as const;

// Move a flock between the MAIN and YOUNG groups. The analytics read flock_segment_history, so
// history keeps the old group and the new one counts from today. Setting a flock whose segment is
// "not set" just sets it (it counts for all dates). A segment can be changed but not cleared.
export async function setFlockSegment(flockId: string, formData: FormData): Promise<void> {
  const seg = String(formData.get("segment") ?? "");
  if (!(SEGMENTS as readonly string[]).includes(seg)) return;
  const today = new Date().toISOString().slice(0, 10);
  await withTransaction(async (client) => {
    const { rows } = await client.query(`SELECT segment FROM flocks WHERE flock_internal_id = $1 AND farm_code = $2 FOR UPDATE`, [flockId, ACTIVE_FARM]);
    if (rows.length === 0) return;
    const old: string | null = rows[0].segment;
    if (old === seg) return;
    if (old) {
      // baseline: before the first recorded change the flock was in its old group
      await client.query(
        `INSERT INTO flock_segment_history (flock_internal_id, segment, effective_from)
         SELECT $1, $2, DATE '1900-01-01' WHERE NOT EXISTS (SELECT 1 FROM flock_segment_history WHERE flock_internal_id = $1)`,
        [flockId, old]
      );
      await client.query(
        `INSERT INTO flock_segment_history (flock_internal_id, segment, effective_from) VALUES ($1, $2, $3)
         ON CONFLICT (flock_internal_id, effective_from) DO UPDATE SET segment = EXCLUDED.segment`,
        [flockId, seg, today]
      );
    }
    await client.query(`UPDATE flocks SET segment = $2, updated_at = now() WHERE flock_internal_id = $1`, [flockId, seg]);
  });
  void pool;
  revalidatePath("/flocks");
  revalidatePath("/analytics");
  revalidatePath("/today");
}
