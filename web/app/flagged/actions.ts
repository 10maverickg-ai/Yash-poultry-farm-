"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { pool, withTransaction } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import type { FlaggedSource } from "@/lib/records";
import { createSaleForEntryAs } from "@/lib/salesSync";
import { insertDailyProductionRow } from "@/lib/extraction/writeDailyProduction";
import {
  resolveFlockMovementAsTransfer,
  resolveFlockMovementAsAnilFarm,
  resolveFlockMovementAsSale,
  resolveFlockMovementAsPurchased,
  resolveFlockMovementAsCull,
  resolveFlockMovementAsCountAdjustment,
} from "@/lib/flockMovements";

// Fixed mapping — never interpolate a table name from user input.
const TABLES: Record<FlaggedSource, string> = {
  production: "daily_production",
  egg_stock: "daily_egg_stock_summary",
  feed_stock: "feed_stock",
  feed_bag_stock: "daily_feed_bag_stock",
};

// "Mark reviewed" acknowledges a flag that reflects a real event rather than
// a data error (e.g. a genuine mortality spike): the record keeps
// flagged = true for the audit trail, but leaves the queue. Data errors are
// instead fixed on their entry screen, where a re-save re-validates and
// clears the flag itself. Editing a record's data resets reviewed_by_owner,
// so a changed record re-enters the queue if it still violates a rule.
export async function markReviewed(source: FlaggedSource, id: number) {
  const table = TABLES[source];
  if (!table) throw new Error("Unknown record type");
  await pool.query(
    `UPDATE ${table} SET reviewed_by_owner = true WHERE id = $1 AND farm_code = $2`,
    [id, ACTIVE_FARM]
  );
  revalidatePath("/flagged");
  redirect("/flagged");
}

// Egg-ledger lines (daily_egg_stock_entries) carry their own flagged /
// reviewed_by_owner columns but have no farm_code, so the farm check goes
// through the parent summary row. Same acknowledge-only semantics as
// markReviewed above.
export async function markEggEntryReviewed(id: number) {
  await pool.query(
    `UPDATE daily_egg_stock_entries SET reviewed_by_owner = true
      WHERE id = $1
        AND egg_stock_summary_id IN (SELECT id FROM daily_egg_stock_summary WHERE farm_code = $2)`,
    [id, ACTIVE_FARM]
  );
  revalidatePath("/flagged");
  redirect("/flagged");
}

// Page-level checksum issues (lib/extraction/pageChecksum.ts) belong to the
// whole upload, not any one flock row — same reviewed/deleted lifecycle as
// every other flagged thing in this app, just its own small table
// (daily_production_page_issues, migration 0015) so a page issue can be
// acknowledged or dismissed independently of any flock's own flag.
export async function markPageIssueReviewed(id: number) {
  await pool.query(
    `UPDATE daily_production_page_issues SET reviewed_by_owner = true WHERE id = $1 AND farm_code = $2`,
    [id, ACTIVE_FARM]
  );
  revalidatePath("/flagged");
  redirect("/flagged");
}

export async function deletePageIssue(id: number) {
  await pool.query(
    `UPDATE daily_production_page_issues SET deleted_at = now() WHERE id = $1 AND farm_code = $2 AND deleted_at IS NULL`,
    [id, ACTIVE_FARM]
  );
  revalidatePath("/flagged");
  redirect("/flagged");
}

// Egg-ledger/feed-box extraction failures (migration 0020, owner request
// 2026-10-19) — same reviewed/deleted lifecycle as page issues above, own
// small table so a failed ledger/feed read can be acknowledged or dismissed
// independently of any Daily Production flag.
export async function markLedgerIssueReviewed(id: number) {
  await pool.query(
    `UPDATE ledger_extraction_issues SET reviewed_by_owner = true WHERE id = $1 AND farm_code = $2`,
    [id, ACTIVE_FARM]
  );
  revalidatePath("/flagged");
  redirect("/flagged");
}

export async function deleteLedgerIssue(id: number) {
  await pool.query(
    `UPDATE ledger_extraction_issues SET deleted_at = now() WHERE id = $1 AND farm_code = $2 AND deleted_at IS NULL`,
    [id, ACTIVE_FARM]
  );
  revalidatePath("/flagged");
  redirect("/flagged");
}

// Manually points an unresolved_extractions row (a photo-extracted flock
// whose label didn't match any active flock, even after forgiving-formatting
// matching) at the flock the owner identifies it as. Writes a normal
// daily_production row from the raw numbers already saved — the owner never
// has to re-read the photo or re-type anything, just pick the right flock.
export async function resolveExtraction(unresolvedId: number, formData: FormData) {
  const flockInternalId = formData.get("flockInternalId");
  if (typeof flockInternalId !== "string" || !flockInternalId) {
    throw new Error("Choose a flock");
  }

  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM unresolved_extractions
        WHERE id = $1 AND farm_code = $2 AND resolved_at IS NULL AND deleted_at IS NULL`,
      [unresolvedId, ACTIVE_FARM]
    );
    const row = rows[0];
    if (!row) throw new Error("This row was already resolved or no longer exists");

    if (row.register_type !== "daily_production") {
      throw new Error(`Resolving ${row.register_type} rows isn't supported yet`);
    }

    await insertDailyProductionRow(client, ACTIVE_FARM, row.date, flockInternalId, {
      displayLabelAsWritten: row.display_label_as_written,
      shedCode: row.shed_code,
      mortality: row.mortality,
      feedBags: row.feed_bags,
      eggsTotal: row.eggs_total,
      birdPopulation: row.bird_population,
      hdPercentWritten: row.hd_percent_written,
      confidence: row.ocr_confidence,
      sourcePhotoUrl: row.source_photo_url,
      sectionsFound: row.sections_found,
      pageNotes: row.page_notes,
    });

    await client.query(
      `UPDATE unresolved_extractions SET resolved_at = now(), resolved_flock_internal_id = $2 WHERE id = $1`,
      [unresolvedId, flockInternalId]
    );
  });

  revalidatePath("/flagged");
  revalidatePath("/production");
  revalidatePath("/records");
  redirect("/flagged");
}

// Soft delete for wrong or duplicate data (old test uploads, a duplicate
// upload of the same page, etc.) — distinct from "Mark reviewed", which
// acknowledges a flag that reflects a real event. Never a hard DELETE: sets
// deleted_at, and every query this app runs against daily_production /
// unresolved_extractions excludes deleted rows, including the analytics
// paths (fn_validate_daily_production's trailing-average and previous-
// population lookups, fn_bv300_cum_mortality, the flocks.current_bird_count
// mirror). Handles both a single delete and a multi-select bulk delete —
// same action, just pass one id or many in whichever array applies.
export async function deleteFlaggedRecords(input: {
  productionIds?: number[];
  unresolvedIds?: number[];
}) {
  const productionIds = input.productionIds ?? [];
  const unresolvedIds = input.unresolvedIds ?? [];
  if (productionIds.length === 0 && unresolvedIds.length === 0) return;

  await withTransaction(async (client) => {
    if (productionIds.length > 0) {
      await client.query(
        `UPDATE daily_production SET deleted_at = now()
          WHERE farm_code = $1 AND id = ANY($2::bigint[]) AND deleted_at IS NULL`,
        [ACTIVE_FARM, productionIds]
      );
    }
    if (unresolvedIds.length > 0) {
      await client.query(
        `UPDATE unresolved_extractions SET deleted_at = now()
          WHERE farm_code = $1 AND id = ANY($2::bigint[]) AND deleted_at IS NULL`,
        [ACTIVE_FARM, unresolvedIds]
      );
    }
  });

  revalidatePath("/flagged");
  revalidatePath("/production");
  revalidatePath("/records");
}

// Bird movements — one-tap review (see lib/flockMovements.ts for the
// resolution rules and docs/DECISIONS.md for why these are the choices).
// No try/catch, same as markReviewed/markPageIssueReviewed above: these are
// plain <form action={fn.bind(null, id)}> submits with no useActionState
// wiring, so a genuine error surfaces as Next's own error boundary rather
// than a silently-swallowed failure — consistent with every other action in
// this file at this same level of simplicity.

export async function resolveMovementAsTransfer(id: number, formData: FormData) {
  const counterpartFlockId = formData.get("counterpartFlockId");
  if (typeof counterpartFlockId !== "string" || !counterpartFlockId) {
    throw new Error("Choose a flock");
  }
  await resolveFlockMovementAsTransfer(id, counterpartFlockId);
  revalidatePath("/flagged");
  redirect("/flagged");
}

export async function resolveMovementAsAnilFarm(id: number) {
  await resolveFlockMovementAsAnilFarm(id);
  revalidatePath("/flagged");
  redirect("/flagged");
}

export async function resolveMovementAsSale(id: number, formData: FormData) {
  const priceRaw = formData.get("pricePerBird");
  const price = typeof priceRaw === "string" && priceRaw.trim() !== "" ? Number(priceRaw) : null;
  if (price !== null && (!Number.isFinite(price) || price <= 0)) {
    throw new Error("Enter a valid price per bird, or leave it blank");
  }
  await resolveFlockMovementAsSale(id, price);
  revalidatePath("/flagged");
  redirect("/flagged");
}

export async function resolveMovementAsPurchased(id: number) {
  await resolveFlockMovementAsPurchased(id);
  revalidatePath("/flagged");
  redirect("/flagged");
}

export async function resolveMovementAsCull(id: number) {
  await resolveFlockMovementAsCull(id);
  revalidatePath("/flagged");
  redirect("/flagged");
}

export async function resolveMovementAsCountAdjustment(id: number) {
  await resolveFlockMovementAsCountAdjustment(id);
  revalidatePath("/flagged");
  redirect("/flagged");
}

// One-tap answers for a ledger line the reader could not classify (the way the 15 and 24 Sep lines were fixed by
// hand). Writes the category, marks the line reviewed, and for a sale (re)creates the sales row at the right price:
// Farmfresh = that day's rate − 0.03, local = rate + 0.01. Moving a line away from "sale" removes its sales row.
const EGG_ANSWERS = {
  sale: { category: "sale", kind: "farmfresh" as const },
  local_sale: { category: "local_sale", kind: "local" as const },
  breakage: { category: "breakage", kind: null },
  labour_take: { category: "labour_take", kind: null },
  anil: { category: "cross_farm_adjustment", kind: null },
  addition: { category: "production_addition", kind: null },
  other: { category: "other", kind: null },
} as const;
export type EggAnswer = keyof typeof EGG_ANSWERS;

export async function answerEggEntry(id: number, answer: string) {
  const a = EGG_ANSWERS[answer as EggAnswer];
  if (!a) throw new Error("Unknown answer");
  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT e.id, e.label_as_written, e.amount_eggs, e.linked_sale_id, s.date, s.section
         FROM daily_egg_stock_entries e JOIN daily_egg_stock_summary s ON s.id = e.egg_stock_summary_id
        WHERE e.id = $1 AND s.farm_code = $2 FOR UPDATE OF e`,
      [id, ACTIVE_FARM]
    );
    const e = rows[0];
    if (!e) throw new Error("That ledger line was not found");
    await client.query(`UPDATE daily_egg_stock_entries SET category = $2::egg_stock_entry_category, reviewed_by_owner = true WHERE id = $1`, [id, a.category]);
    const entry = { id, labelAsWritten: e.label_as_written ?? "", amountEggsSigned: e.amount_eggs, linkedSaleId: e.linked_sale_id ? Number(e.linked_sale_id) : null };
    if (a.kind) {
      await createSaleForEntryAs(client, entry, e.date, e.section, a.kind);
    } else if (entry.linkedSaleId) {
      await client.query(`UPDATE daily_egg_stock_entries SET linked_sale_id = NULL WHERE id = $1`, [id]);
      await client.query(`DELETE FROM sales WHERE id = $1`, [entry.linkedSaleId]);
    }
  });
  revalidatePath("/flagged");
  revalidatePath("/sales");
  revalidatePath("/egg-stock");
  revalidatePath("/analytics");
  redirect("/flagged");
}
