import { pool } from "@/lib/db";
import { ACTIVE_FARM } from "@/lib/farm";

// The monthly "inputs still missing" checklist. An input counts as dealt with when
// a real figure exists for that month, or the owner has said "none this month"
// (diesel, medicines) / "this figure is right" (labour, packing). Nothing is ever
// filled in on the owner's behalf.
export type InputKey = "electricity" | "diesel" | "medicines" | "labour" | "packing" | "other";

export interface ChecklistItem {
  key: InputKey;
  label: string;
  done: boolean;
  how: string; // what is recorded, in words
  standing?: number; // current standing figure (labour per month, packing per tray)
}

export async function monthChecklist(month: string): Promise<ChecklistItem[]> {
  const first = `${month}-01`;
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const [cs, diesel, purch, status, labour, packing, medLines, defaults] = await Promise.all([
    pool.query(`SELECT cost_type, value FROM cost_settings WHERE farm_code = $1 AND month = $2`, [ACTIVE_FARM, month]),
    pool.query(`SELECT count(*)::int AS n FROM diesel_purchases WHERE farm_code = $1 AND to_char(date,'YYYY-MM') = $2`, [ACTIVE_FARM, month]),
    pool.query(`SELECT category, count(*)::int AS n FROM purchases WHERE farm_code = $1 AND to_char(date,'YYYY-MM') = $2 GROUP BY category`, [ACTIVE_FARM, month]),
    pool.query(`SELECT input_key, status FROM monthly_input_status WHERE farm_code = $1 AND month = $2`, [ACTIVE_FARM, month]),
    pool.query(`SELECT value FROM cost_settings WHERE farm_code = $1 AND cost_type = 'labour_month' AND month IS NULL AND effective_from <= $2 ORDER BY effective_from DESC LIMIT 1`, [ACTIVE_FARM, first]),
    pool.query(`SELECT value FROM cost_settings WHERE farm_code = $1 AND cost_type = 'packing_per_tray' AND month IS NULL AND effective_from <= $2 ORDER BY effective_from DESC LIMIT 1`, [ACTIVE_FARM, first]),
    pool.query(`SELECT count(*)::int AS n FROM medicine_lines WHERE farm_code = $1 AND to_char(date,'YYYY-MM') = $2 AND amount_inr IS NOT NULL`, [ACTIVE_FARM, month]),
    // V19 D: the owner's averages in force by the end of the month (and medicines inside the feed price)
    pool.query(
      `SELECT DISTINCT ON (cost_type) cost_type, value, effective_from::text AS from FROM cost_settings
        WHERE farm_code = $1 AND month IS NULL AND effective_from <= $2
          AND cost_type IN ('electricity_month_default','diesel_month_default','miscellaneous_month_default','medicine_vaccine_in_feed')
        ORDER BY cost_type, effective_from DESC`,
      [ACTIVE_FARM, last]
    ),
  ]);
  const def = new Map<string, { value: number; from: string }>(defaults.rows.map((r) => [r.cost_type, { value: Number(r.value), from: r.from }]));
  const rs = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
  const st = new Map<string, string>(status.rows.map((r) => [r.input_key, r.status]));
  const has = (t: string) => cs.rows.some((r) => r.cost_type === t);
  const pn = (cats: string[]) => purch.rows.filter((r) => cats.includes(r.category)).reduce((s, r) => s + r.n, 0);
  const elec = has("electricity_month");
  const dsl = diesel.rows[0].n + pn(["diesel"]);
  const med = pn(["medicine", "vaccine"]) + medLines.rows[0].n; // register lines with a cost count; lines without a cost do not
  const labourExact = has("labour_month");
  const oth = pn(["feed_ingredient", "packing", "electricity", "labour", "other"]);
  return [
    { key: "electricity", label: "Electricity bill", done: elec || def.has("electricity_month_default"), how: elec ? "entered" : def.has("electricity_month_default") ? `no bill yet: the average ${rs(def.get("electricity_month_default")!.value)} is used (shown as “average”) — enter the real bill when it comes` : "not entered — counted as 0 until you enter it" },
    { key: "diesel", label: "Diesel", done: dsl > 0 || st.get("diesel") === "none" || def.has("diesel_month_default"), how: dsl > 0 ? `${dsl} purchase(s) entered` : st.get("diesel") === "none" ? "none bought this month" : def.has("diesel_month_default") ? `nothing entered: the average ${rs(def.get("diesel_month_default")!.value)} a month is used` : "nothing entered" },
    { key: "medicines", label: "Medicines and vaccines", done: med > 0 || st.get("medicines") === "none" || (def.get("medicine_vaccine_in_feed")?.from ?? "9999") <= first, how: med > 0 ? `${med} line(s) with a cost entered (Medicines screen)` : st.get("medicines") === "none" ? "none this month" : def.has("medicine_vaccine_in_feed") ? `included in the feed price from ${Number(def.get("medicine_vaccine_in_feed")!.from.slice(8, 10))}-${def.get("medicine_vaccine_in_feed")!.from.slice(5, 7)}-${def.get("medicine_vaccine_in_feed")!.from.slice(0, 4)} (add a cost only for a top dressing)${def.get("medicine_vaccine_in_feed")!.from > first ? "; the days before that: nothing entered" : ""}` : "nothing entered — use the Medicines screen" },
    { key: "labour", label: "Labour (monthly total)", done: labourExact || st.get("labour") === "confirmed", how: labourExact ? "entered for this month" : st.get("labour") === "confirmed" ? "standing figure confirmed" : "using the standing estimate — not confirmed", standing: labour.rows[0] ? Number(labour.rows[0].value) : undefined },
    { key: "other", label: "Other costs (repairs, transport, vet visits…)", done: oth > 0 || st.get("other") === "none" || def.has("miscellaneous_month_default"), how: oth > 0 ? `${oth} purchase(s) entered` : st.get("other") === "none" ? "none this month" : def.has("miscellaneous_month_default") ? `covered by the miscellaneous average ${rs(def.get("miscellaneous_month_default")!.value)} a month` : "nothing entered" },
    { key: "packing", label: "Packing (₹ per tray sold)", done: st.get("packing") === "confirmed", how: st.get("packing") === "confirmed" ? "standing figure confirmed" : "using the standing estimate — not confirmed", standing: packing.rows[0] ? Number(packing.rows[0].value) : undefined },
  ];
}
