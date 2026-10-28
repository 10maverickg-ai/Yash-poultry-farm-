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
  const [cs, diesel, purch, status, labour, packing] = await Promise.all([
    pool.query(`SELECT cost_type, value FROM cost_settings WHERE farm_code = $1 AND month = $2`, [ACTIVE_FARM, month]),
    pool.query(`SELECT count(*)::int AS n FROM diesel_purchases WHERE farm_code = $1 AND to_char(date,'YYYY-MM') = $2`, [ACTIVE_FARM, month]),
    pool.query(`SELECT category, count(*)::int AS n FROM purchases WHERE farm_code = $1 AND to_char(date,'YYYY-MM') = $2 GROUP BY category`, [ACTIVE_FARM, month]),
    pool.query(`SELECT input_key, status FROM monthly_input_status WHERE farm_code = $1 AND month = $2`, [ACTIVE_FARM, month]),
    pool.query(`SELECT value FROM cost_settings WHERE farm_code = $1 AND cost_type = 'labour_month' AND month IS NULL AND effective_from <= $2 ORDER BY effective_from DESC LIMIT 1`, [ACTIVE_FARM, first]),
    pool.query(`SELECT value FROM cost_settings WHERE farm_code = $1 AND cost_type = 'packing_per_tray' AND month IS NULL AND effective_from <= $2 ORDER BY effective_from DESC LIMIT 1`, [ACTIVE_FARM, first]),
  ]);
  const st = new Map<string, string>(status.rows.map((r) => [r.input_key, r.status]));
  const has = (t: string) => cs.rows.some((r) => r.cost_type === t);
  const pn = (cats: string[]) => purch.rows.filter((r) => cats.includes(r.category)).reduce((s, r) => s + r.n, 0);
  const elec = has("electricity_month");
  const dsl = diesel.rows[0].n + pn(["diesel"]);
  const med = pn(["medicine", "vaccine"]);
  const labourExact = has("labour_month");
  const oth = pn(["feed_ingredient", "packing", "electricity", "labour", "other"]);
  return [
    { key: "electricity", label: "Electricity bill", done: elec, how: elec ? "entered" : "not entered — counted as 0 until you enter it" },
    { key: "diesel", label: "Diesel", done: dsl > 0 || st.get("diesel") === "none", how: dsl > 0 ? `${dsl} purchase(s) entered` : st.get("diesel") === "none" ? "none bought this month" : "nothing entered" },
    { key: "medicines", label: "Medicines and vaccines", done: med > 0 || st.get("medicines") === "none", how: med > 0 ? `${med} purchase(s) entered` : st.get("medicines") === "none" ? "none bought this month" : "nothing entered" },
    { key: "labour", label: "Labour (monthly total)", done: labourExact || st.get("labour") === "confirmed", how: labourExact ? "entered for this month" : st.get("labour") === "confirmed" ? "standing figure confirmed" : "using the standing estimate — not confirmed", standing: labour.rows[0] ? Number(labour.rows[0].value) : undefined },
    { key: "other", label: "Other costs (repairs, transport, vet visits…)", done: oth > 0 || st.get("other") === "none", how: oth > 0 ? `${oth} purchase(s) entered` : st.get("other") === "none" ? "none this month" : "nothing entered" },
    { key: "packing", label: "Packing (₹ per tray sold)", done: st.get("packing") === "confirmed", how: st.get("packing") === "confirmed" ? "standing figure confirmed" : "using the standing estimate — not confirmed", standing: packing.rows[0] ? Number(packing.rows[0].value) : undefined },
  ];
}
