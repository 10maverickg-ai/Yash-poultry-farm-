"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";

// Fixed mapping — never interpolate a table name from user input.
const TABLES = {
  production: "daily_production",
  feed_bag_stock: "daily_feed_bag_stock",
} as const;

// "Reviewed" on an alert sets the same reviewed_by_owner flag "Mark
// reviewed" on /flagged sets, on the record the alert is about; the engine
// then stops alerting on that record. Nothing else is written.
export async function markAlertReviewed(
  source: keyof typeof TABLES,
  id: number,
  returnTo: string,
) {
  const table = TABLES[source];
  if (!table) throw new Error("Unknown record type");
  await pool.query(
    `UPDATE ${table} SET reviewed_by_owner = true WHERE id = $1 AND farm_code = $2`,
    [id, ACTIVE_FARM],
  );
  revalidatePath("/analytics");
  // Only ever return to a path inside /analytics.
  redirect(returnTo.startsWith("/analytics") ? returnTo : "/analytics");
}
