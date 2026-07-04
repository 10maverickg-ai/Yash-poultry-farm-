"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";
import type { FlaggedSource } from "@/lib/records";

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
