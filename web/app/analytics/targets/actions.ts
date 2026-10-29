"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";

const back = (msg: string, ok = false): never => {
  revalidatePath("/analytics/targets");
  redirect(`/analytics/targets?${ok ? "saved" : "error"}=${encodeURIComponent(msg)}`);
};
const GROUPS = ["main", "young"];
const METRICS = ["hd", "feed", "mortality"];

// Owner override for one age band: "our realistic level = X % of the breeder's book". Wins over the learned value.
export async function setOverride(formData: FormData) {
  const grp = String(formData.get("grp") ?? "");
  const metric = String(formData.get("metric") ?? "");
  const band = Number(formData.get("band_start"));
  const pct = Number(String(formData.get("ratio_pct") ?? "").replace(",", "."));
  if (!GROUPS.includes(grp) || !METRICS.includes(metric) || !Number.isInteger(band) || band < 0) back("Unknown band.");
  if (!Number.isFinite(pct) || pct <= 0) back("Type the level as a percentage of the book, for example 85.");
  if (metric !== "mortality" && pct > 100) back("The realistic level can never be above the breeder's book (100%). Type 100 or less.");
  if (metric === "mortality" && pct < 100) back("Deaths can never be better than the book (100%). Type 100 or more.");
  await pool.query(
    `INSERT INTO realistic_target_overrides (farm_code, grp, metric, band_start, ratio_pct, note)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (farm_code, grp, metric, band_start) DO UPDATE SET ratio_pct = EXCLUDED.ratio_pct, note = EXCLUDED.note, created_at = now()`,
    [ACTIVE_FARM, grp, metric, band, pct, String(formData.get("note") ?? "").trim() || null],
  );
  back("Saved. This band is now marked “set by owner”.", true);
}

export async function clearOverride(formData: FormData) {
  await pool.query(`DELETE FROM realistic_target_overrides WHERE farm_code=$1 AND grp=$2 AND metric=$3 AND band_start=$4`, [
    ACTIVE_FARM,
    String(formData.get("grp") ?? ""),
    String(formData.get("metric") ?? ""),
    Number(formData.get("band_start")),
  ]);
  back("Back to the learned value.", true);
}
