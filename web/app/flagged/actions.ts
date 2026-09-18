"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { pool, withTransaction } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import type { FlaggedSource } from "@/lib/records";
import { insertDailyProductionRow } from "@/lib/extraction/writeDailyProduction";

// Fixed mapping — never interpolate a table name from user input.
const TABLES: Record<FlaggedSource, string> = {
  production: "daily_production",
  egg_stock: "daily_egg_stock_summary",
  feed_stock: "feed_stock",
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
      `SELECT * FROM unresolved_extractions WHERE id = $1 AND farm_code = $2 AND resolved_at IS NULL`,
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
      hdPercent: row.hd_percent,
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
