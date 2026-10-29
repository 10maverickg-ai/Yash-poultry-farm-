"use server";

import { requireOwner } from "@/lib/auth/guard";
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
  await requireOwner();
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

// The owner's verdict on an alert: "this was real" or "this was noise". One
// verdict per alert (saving again changes it). Used to tune the rules from
// evidence; it never changes or hides the alert itself.
export async function saveAlertFeedback(alertKey: string, verdict: "real" | "noise", returnTo: string) {
  await requireOwner();
  if (verdict !== "real" && verdict !== "noise") throw new Error("Unknown verdict");
  if (!/^[a-z_]+\|\d{4}-\d{2}-\d{2}\|[0-9a-f-]+(#\d+)?$|^[a-z_]+\|\d{4}-\d{2}-\d{2}\|farm(#\d+)?$/.test(alertKey)) throw new Error("Bad alert key");
  await pool.query(
    `INSERT INTO alert_feedback (farm_code, alert_key, verdict) VALUES ($1,$2,$3)
     ON CONFLICT (farm_code, alert_key) DO UPDATE SET verdict = EXCLUDED.verdict, created_at = now()`,
    [ACTIVE_FARM, alertKey, verdict]
  );
  revalidatePath("/analytics");
  redirect(returnTo.startsWith("/analytics") ? returnTo : "/analytics");
}
