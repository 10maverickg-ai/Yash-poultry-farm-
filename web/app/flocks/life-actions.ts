"use server";

import { requireOwner } from "@/lib/auth/guard";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { pool, withTransaction } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";

const iso = /^\d{4}-\d{2}-\d{2}$/;
const STAGES = ["chick", "grower", "pre_lay", "layer", "moulting", "sold", "depleted"];
const ENUM_STAGES = ["chick", "grower", "pre_lay", "layer", "moulting"];

function back(path: string, msg: string, ok = false): never {
  revalidatePath(path.split("?")[0]);
  redirect(`${path}${path.includes("?") ? "&" : "?"}${ok ? "saved" : "error"}=${encodeURIComponent(msg)}`);
}

// Lifecycle: appends a dated stage event and closes the previous open one.
// Stages that exist in the flocks.current_stage enum also update that column.
export async function addStageEvent(flockId: string, formData: FormData) {
  await requireOwner();
  const path = `/flocks/${flockId}`;
  const stage = String(formData.get("stage") ?? "");
  const from = String(formData.get("from_date") ?? "");
  if (!STAGES.includes(stage)) back(path, "Choose a stage.");
  if (!iso.test(from)) back(path, "Choose the date it started.");
  await withTransaction(async (client) => {
    await client.query(`UPDATE flock_stage_history SET to_date = $2 WHERE flock_internal_id = $1 AND to_date IS NULL AND from_date <= $2`, [flockId, from]);
    await client.query(`INSERT INTO flock_stage_history (flock_internal_id, stage, from_date, note) VALUES ($1,$2,$3,$4)`, [flockId, stage, from, String(formData.get("note") ?? "") || null]);
    if (ENUM_STAGES.includes(stage)) {
      await client.query(`UPDATE flocks SET current_stage = $2::flock_stage WHERE flock_internal_id = $1 AND farm_code = $3`, [flockId, stage, ACTIVE_FARM]);
    }
  });
  back(path, "Stage saved.", true);
}

export async function addMoultPeriod(formData: FormData) {
  await requireOwner();
  const flockId = String(formData.get("flock") ?? "");
  const start = String(formData.get("start_date") ?? "");
  const end = String(formData.get("end_date") ?? "");
  const path = "/flocks/moulting";
  if (!flockId) back(path, "Choose the flock.");
  if (!iso.test(start)) back(path, "Choose the start date.");
  if (end && (!iso.test(end) || end < start)) back(path, "The end date must be after the start date.");
  await pool.query(
    `INSERT INTO moulting_periods (flock_internal_id, start_date, end_date, confirmed_by_owner, note) VALUES ($1,$2,$3,true,$4)`,
    [flockId, start, end || null, String(formData.get("note") ?? "") || null]
  );
  back(path, "Moulting period saved.", true);
}

export async function confirmMoult(id: number, formData: FormData) {
  await requireOwner();
  const start = String(formData.get("start_date") ?? "");
  const end = String(formData.get("end_date") ?? "");
  const path = "/flocks/moulting";
  if (!iso.test(start)) back(path, "Choose the start date.");
  if (end && (!iso.test(end) || end < start)) back(path, "The end date must be after the start date.");
  await pool.query(`UPDATE moulting_periods SET start_date = $2, end_date = $3, confirmed_by_owner = true WHERE id = $1`, [id, start, end || null]);
  back(path, "Moulting dates confirmed.", true);
}

export async function addBatch(formData: FormData) {
  await requireOwner();
  const path = "/flocks/batches";
  const arrival = String(formData.get("arrival_date") ?? "");
  const count = Number(formData.get("starting_count"));
  if (!iso.test(arrival)) back(path, "Choose the arrival date.");
  if (!Number.isInteger(count) || count <= 0) back(path, "Enter how many chicks arrived.");
  await pool.query(
    `INSERT INTO chick_batches (farm_code, arrival_date, source, starting_count, shed_side, status, note) VALUES ($1,$2,$3,$4,$5,'in_chick_shed',$6)`,
    [ACTIVE_FARM, arrival, String(formData.get("source") ?? "") || null, count, String(formData.get("shed_side") ?? "") || null, String(formData.get("note") ?? "") || null]
  );
  back(path, "Batch saved.", true);
}

export async function updateBatch(id: number, formData: FormData) {
  await requireOwner();
  const path = "/flocks/batches";
  const status = String(formData.get("status") ?? "");
  const moved = String(formData.get("moved_to_layer_date") ?? "");
  const flock = String(formData.get("resulting_flock_id") ?? "");
  if (!["in_chick_shed", "moved_to_layer", "to_anil_farm", "mixed"].includes(status)) back(path, "Choose a status.");
  if (moved && !iso.test(moved)) back(path, "Check the move date.");
  await withTransaction(async (client) => {
    await client.query(
      `UPDATE chick_batches SET status = $2, moved_to_layer_date = $3, resulting_flock_id = $4 WHERE id = $1 AND farm_code = $5`,
      [id, status, moved || null, flock || null, ACTIVE_FARM]
    );
    if (flock) await client.query(`UPDATE flocks SET chick_batch_id = $2 WHERE flock_internal_id = $1`, [flock, id]);
  });
  back(path, "Batch updated.", true);
}
