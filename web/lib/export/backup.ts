import JSZip from "jszip";
import { pool } from "@/lib/db";

// Every operational table, as CSV, in one zip. Read-only; fixed table list (no
// table name ever comes from the request). Soft-deleted rows ARE included (their
// deleted_at column says so) so the backup is complete. A table that does not
// exist yet in this database is skipped and said so in README.txt.
export const BACKUP_TABLES = [
  "farms", "sheds", "flocks", "flock_label_history", "flock_stage_history", "moulting_periods", "chick_batches", "chick_batch_log",
  "daily_production", "daily_production_page_issues", "unresolved_extractions", "ledger_extraction_issues",
  "daily_egg_stock_summary", "daily_egg_stock_entries", "daily_egg_stock_summary_flocks",
  "daily_feed_bag_stock", "daily_feed_bag_stock_flocks", "feed_stock", "feed_materials", "feed_formulation",
  "chick_daily_mortality", "flock_movements", "sales", "daily_egg_rates",
  "purchases", "diesel_purchases", "cost_settings", "vaccination_schedule",
  "knowledge_documents", "knowledge_entries", "knowledge_standards", "alert_feedback", "upload_queue",
] as const;

const cell = (v: unknown): string => {
  if (v == null) return "";
  const s = v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function buildBackupZip(now = new Date()): Promise<{ data: Uint8Array; filename: string; counts: Record<string, number | "missing"> }> {
  const zip = new JSZip();
  const counts: Record<string, number | "missing"> = {};
  for (const t of BACKUP_TABLES) {
    const exists = await pool.query(`SELECT to_regclass($1) AS r`, [`public.${t}`]);
    if (!exists.rows[0].r) { counts[t] = "missing"; continue; }
    const res = await pool.query(`SELECT * FROM public."${t}"`);
    const header = res.fields.map((f) => cell(f.name)).join(",");
    const lines = res.rows.map((r) => res.fields.map((f) => cell(r[f.name])).join(","));
    zip.file(`${t}.csv`, "﻿" + [header, ...lines].join("\r\n") + "\r\n");
    counts[t] = res.rowCount ?? res.rows.length;
  }
  const stamp = now.toISOString().slice(0, 16).replace("T", "-").replace(":", "");
  zip.file(
    "README.txt",
    `Yash Poultry Farm - backup taken ${now.toISOString()} (UTC)\r\n\r\nOne CSV per table (UTF-8, dates as YYYY-MM-DD). Deleted rows are included; their deleted_at column is filled.\r\n\r\n` +
      Object.entries(counts).map(([t, n]) => `${t}: ${n === "missing" ? "(table not in this database)" : `${n} rows`}`).join("\r\n") + "\r\n"
  );
  const data = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
  return { data, filename: `yash-farm-backup-${stamp}.zip`, counts };
}
