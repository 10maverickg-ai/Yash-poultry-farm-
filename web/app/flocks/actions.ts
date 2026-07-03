"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { withTransaction } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import { errorMessage, optDate, optInt, optStr } from "@/lib/forms";

function fail(path: string, msg: string): never {
  redirect(`${path}?error=${encodeURIComponent(msg)}`);
}

function done(path: string): never {
  revalidatePath("/flocks");
  redirect(path);
}

// ---------------------------------------------------------------------------
// Create flock — also opens its first flock_label_history row, so label
// resolution works from day one.
// ---------------------------------------------------------------------------
export async function createFlock(formData: FormData) {
  let error: string | null = null;
  try {
    const displayLabel = optStr(formData, "display_label");
    if (!displayLabel) throw new Error("Display label is required");
    const placementDate = optDate(formData, "placement_date");
    const labelFrom = placementDate ?? new Date().toISOString().slice(0, 10);

    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT 1 FROM flocks
          WHERE farm_code = $1 AND display_label = $2 AND status = 'active'`,
        [ACTIVE_FARM, displayLabel]
      );
      if (rows.length > 0)
        throw new Error(
          `An active flock already uses label "${displayLabel}" — use the renumbering form if labels are shifting`
        );

      const inserted = await client.query(
        `INSERT INTO flocks (farm_code, display_label, breed, placement_date,
             source_hatchery, hatchery_bill_photo_url, initial_chick_count,
             current_bird_count, current_shed, current_stage, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING flock_internal_id`,
        [
          ACTIVE_FARM,
          displayLabel,
          optStr(formData, "breed"),
          placementDate,
          optStr(formData, "source_hatchery"),
          optStr(formData, "hatchery_bill_photo_url"),
          optInt(formData, "initial_chick_count"),
          optInt(formData, "current_bird_count") ??
            optInt(formData, "initial_chick_count"),
          optStr(formData, "current_shed"),
          optStr(formData, "current_stage"),
          optStr(formData, "notes"),
        ]
      );

      await client.query(
        `INSERT INTO flock_label_history (flock_internal_id, display_label, effective_from)
         VALUES ($1, $2, $3)`,
        [inserted.rows[0].flock_internal_id, displayLabel, labelFrom]
      );
    });
  } catch (err) {
    error = errorMessage(err);
  }
  if (error) fail("/flocks/new", error);
  done("/flocks");
}

// ---------------------------------------------------------------------------
// Edit flock details. A changed display_label here is a same-flock correction
// (typo fix): it updates the flock AND its open label-history row in place.
// Label REASSIGNMENT between flocks must go through the renumbering form.
// ---------------------------------------------------------------------------
export async function updateFlock(flockId: string, formData: FormData) {
  let error: string | null = null;
  try {
    const displayLabel = optStr(formData, "display_label");
    if (!displayLabel) throw new Error("Display label is required");

    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT display_label FROM flocks WHERE flock_internal_id = $1 FOR UPDATE`,
        [flockId]
      );
      if (rows.length === 0) throw new Error("Flock not found");
      const oldLabel: string = rows[0].display_label;

      await client.query(
        `UPDATE flocks
            SET display_label = $2, breed = $3, placement_date = $4,
                source_hatchery = $5, hatchery_bill_photo_url = $6,
                initial_chick_count = $7, current_bird_count = $8,
                current_shed = $9, notes = $10
          WHERE flock_internal_id = $1`,
        [
          flockId,
          displayLabel,
          optStr(formData, "breed"),
          optDate(formData, "placement_date"),
          optStr(formData, "source_hatchery"),
          optStr(formData, "hatchery_bill_photo_url"),
          optInt(formData, "initial_chick_count"),
          optInt(formData, "current_bird_count"),
          optStr(formData, "current_shed"),
          optStr(formData, "notes"),
        ]
      );

      if (displayLabel !== oldLabel) {
        await client.query(
          `UPDATE flock_label_history
              SET display_label = $2
            WHERE flock_internal_id = $1 AND effective_to IS NULL`,
          [flockId, displayLabel]
        );
      }
    });
  } catch (err) {
    error = errorMessage(err);
  }
  if (error) fail(`/flocks/${flockId}`, error);
  done(`/flocks/${flockId}`);
}

// ---------------------------------------------------------------------------
// Stage transition: sets current_stage and records the date under the spec's
// jsonb shape, e.g. {"chick_to_grower": "...", "grower_to_layer": "..."}.
// ---------------------------------------------------------------------------
export async function transitionStage(flockId: string, formData: FormData) {
  let error: string | null = null;
  try {
    const newStage = optStr(formData, "new_stage");
    const transitionDate = optDate(formData, "transition_date");
    if (!newStage || !transitionDate)
      throw new Error("Both new stage and transition date are required");

    await withTransaction(async (client) => {
      const { rows } = await client.query(
        `SELECT current_stage FROM flocks WHERE flock_internal_id = $1 FOR UPDATE`,
        [flockId]
      );
      if (rows.length === 0) throw new Error("Flock not found");
      const prev: string | null = rows[0].current_stage;
      if (prev === newStage) throw new Error(`Flock is already in stage "${newStage}"`);

      if (prev) {
        await client.query(
          `UPDATE flocks
              SET current_stage = $2,
                  stage_transition_dates =
                      coalesce(stage_transition_dates, '{}'::jsonb)
                      || jsonb_build_object($3::text, $4::text)
            WHERE flock_internal_id = $1`,
          [flockId, newStage, `${prev}_to_${newStage}`, transitionDate]
        );
      } else {
        await client.query(
          `UPDATE flocks SET current_stage = $2 WHERE flock_internal_id = $1`,
          [flockId, newStage]
        );
      }
    });
  } catch (err) {
    error = errorMessage(err);
  }
  if (error) fail(`/flocks/${flockId}`, error);
  done(`/flocks/${flockId}`);
}

// ---------------------------------------------------------------------------
// Depletion: flock fully sold off. Closes the open label-history row on the
// depletion date so the label stops resolving to this flock after that day
// (the freed label gets reassigned later via the renumbering form).
// ---------------------------------------------------------------------------
export async function depleteFlock(flockId: string, formData: FormData) {
  let error: string | null = null;
  try {
    const depletionDate = optDate(formData, "depletion_date");
    if (!depletionDate) throw new Error("Depletion date is required");

    await withTransaction(async (client) => {
      const res = await client.query(
        `UPDATE flocks
            SET status = 'depleted', depletion_date = $2
          WHERE flock_internal_id = $1 AND status = 'active'`,
        [flockId, depletionDate]
      );
      if (res.rowCount === 0) throw new Error("Flock not found or already depleted");
      await client.query(
        `UPDATE flock_label_history
            SET effective_to = $2
          WHERE flock_internal_id = $1 AND effective_to IS NULL`,
        [flockId, depletionDate]
      );
    });
  } catch (err) {
    error = errorMessage(err);
  }
  if (error) fail(`/flocks/${flockId}`, error);
  done(`/flocks/${flockId}`);
}

// ---------------------------------------------------------------------------
// Renumbering event: when the oldest flock is depleted, all younger flocks
// shift down one label. For every flock whose label changed: close the open
// history row the day before, open a new row from the effective date, update
// the flock's current label. This is THE mechanism that keeps old production
// rows pointing at the right flock.
// ---------------------------------------------------------------------------
export async function renumberFlocks(formData: FormData) {
  let error: string | null = null;
  try {
    const effectiveFrom = optDate(formData, "effective_from");
    if (!effectiveFrom) throw new Error("Effective date is required");

    const newLabels = new Map<string, string>();
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("label_") && typeof value === "string") {
        const label = value.trim();
        if (!label) throw new Error("Labels cannot be blank");
        newLabels.set(key.slice("label_".length), label);
      }
    }
    if (newLabels.size === 0) throw new Error("No flocks to renumber");

    const labels = [...newLabels.values()];
    if (new Set(labels).size !== labels.length)
      throw new Error("Two flocks cannot share the same label");

    await withTransaction(async (client) => {
      const { rows: active } = await client.query(
        `SELECT flock_internal_id, display_label FROM flocks
          WHERE farm_code = $1 AND status = 'active' FOR UPDATE`,
        [ACTIVE_FARM]
      );
      const currentById = new Map<string, string>(
        active.map((r) => [r.flock_internal_id, r.display_label])
      );

      for (const [flockId, newLabel] of newLabels) {
        const current = currentById.get(flockId);
        if (current === undefined)
          throw new Error("Form includes a flock that is not active — reload and retry");
        if (current === newLabel) continue;

        await client.query(
          `UPDATE flock_label_history
              SET effective_to = $2::date - 1
            WHERE flock_internal_id = $1 AND effective_to IS NULL`,
          [flockId, effectiveFrom]
        );
        await client.query(
          `INSERT INTO flock_label_history (flock_internal_id, display_label, effective_from)
           VALUES ($1, $2, $3)`,
          [flockId, newLabel, effectiveFrom]
        );
        await client.query(
          `UPDATE flocks SET display_label = $2 WHERE flock_internal_id = $1`,
          [flockId, newLabel]
        );
      }
    });
  } catch (err) {
    error = errorMessage(err);
  }
  if (error) fail("/flocks/renumber", error);
  done("/flocks");
}
