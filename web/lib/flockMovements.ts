import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";

// Bird movements the day-to-day count chain (or a margin note the reader
// found) couldn't explain on its own, open for the owner's one-tap review —
// see migration 0021 for the full column meanings and db/DECISIONS.md for
// why "another flock / Anil farm / sold / culled" are the resolution
// choices (ground rules: a margin note with no written destination must
// never be silently guessed at, and Anil farm is a real destination, never
// treated as a loss).

export interface OpenFlockMovement {
  id: number;
  date: string;
  flock_internal_id: string;
  flock_label: string;
  birds_change: number;
  movement_type: string;
  register_note: string | null;
  source: string;
}

export async function listOpenFlockMovements(): Promise<OpenFlockMovement[]> {
  const { rows } = await pool.query<OpenFlockMovement>(
    `SELECT fm.id, fm.date, fm.flock_internal_id, f.display_label AS flock_label,
            fm.birds_change, fm.movement_type, fm.register_note, fm.source
       FROM flock_movements fm
       JOIN flocks f ON f.flock_internal_id = fm.flock_internal_id
      WHERE fm.farm_code = $1 AND fm.needs_review = true AND fm.reviewed_by_owner = false
      ORDER BY fm.date DESC, fm.id`,
    [ACTIVE_FARM]
  );
  return rows;
}

// Every resolution function below only ever updates the ONE row being
// resolved — never the counterpart flock's own side of a transfer, even
// when one might plausibly exist. Guessing which (if any) of the
// counterpart's own rows this matches would be exactly the kind of silent
// assumption the ground rules rule out; if the counterpart flock has its
// own open movement, the owner resolves that separately, the same way.

export async function resolveFlockMovementAsTransfer(
  id: number,
  counterpartFlockId: string
): Promise<void> {
  await pool.query(
    `UPDATE flock_movements
        SET movement_type = CASE WHEN birds_change < 0 THEN 'transfer_out' ELSE 'transfer_in' END,
            counterpart_flock_id = $2,
            reason = 'Moved to/from another flock (owner confirmed)',
            needs_review = false,
            reviewed_by_owner = true
      WHERE id = $1 AND farm_code = $3`,
    [id, counterpartFlockId, ACTIVE_FARM]
  );
}

// "Anil farm" is a sister farm, not a row in `flocks` — named in `buyer`
// (reused generically here for "the counterpart's name when it isn't a
// flock", regardless of direction) rather than modeled as one, per the
// ground rules: never treat it as a loss, and never invent a flock row for
// it.
export async function resolveFlockMovementAsAnilFarm(id: number): Promise<void> {
  await pool.query(
    `UPDATE flock_movements
        SET movement_type = CASE WHEN birds_change < 0 THEN 'transfer_out' ELSE 'transfer_in' END,
            buyer = 'Anil farm',
            reason = 'Shifted to/from Anil farm (owner confirmed)',
            needs_review = false,
            reviewed_by_owner = true
      WHERE id = $1 AND farm_code = $2`,
    [id, ACTIVE_FARM]
  );
}

// A sale is always an outflow — guarded by birds_change < 0 so this can
// never silently "sell in" birds that arrived.
export async function resolveFlockMovementAsSale(
  id: number,
  pricePerBird: number | null
): Promise<void> {
  await pool.query(
    `UPDATE flock_movements
        SET movement_type = 'sale',
            price_per_bird = $2,
            reason = 'Sold (owner confirmed)',
            needs_review = false,
            reviewed_by_owner = true
      WHERE id = $1 AND farm_code = $3 AND birds_change < 0`,
    [id, pricePerBird, ACTIVE_FARM]
  );
}

// Culling is always an outflow too — same guard as a sale.
export async function resolveFlockMovementAsCull(id: number): Promise<void> {
  await pool.query(
    `UPDATE flock_movements
        SET movement_type = 'cull',
            reason = 'Culled (owner confirmed)',
            needs_review = false,
            reviewed_by_owner = true
      WHERE id = $1 AND farm_code = $2 AND birds_change < 0`,
    [id, ACTIVE_FARM]
  );
}

// The fifth, schema-supported option this task's own one-tap list didn't
// name but the existing data already uses (see BAB-2, 2026-08-22, -5,
// backfilled before this PR): the owner is confirming the written count
// itself is correct and nothing actually moved — the chain mismatch is
// just how the numbers landed, not evidence of a real bird movement. Never
// auto-applied; only ever a human's explicit answer, same as every other
// resolution here.
export async function resolveFlockMovementAsCountAdjustment(id: number): Promise<void> {
  await pool.query(
    `UPDATE flock_movements
        SET movement_type = 'count_adjustment',
            reason = 'Confirmed correct as written — nothing moved (owner)',
            needs_review = false,
            reviewed_by_owner = true
      WHERE id = $1 AND farm_code = $2`,
    [id, ACTIVE_FARM]
  );
}
