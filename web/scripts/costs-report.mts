// Prints the monthly cost and profit lines so the owner can check them (V9 J3).
//   DATABASE_URL=... npx tsx scripts/costs-report.mts
import { loadCostInput } from "../lib/costs/load";
import { monthEconomics } from "../lib/costs/engine";
import { pool } from "../lib/db";

const inr = (x: number) => Math.round(x).toLocaleString("en-IN");
const input = await loadCostInput();
const months = [...new Set(input.prod.map((p) => p.date.slice(0, 7)))].sort();
const dim = (ym: string) => new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
console.log("feed price in force:", input.settings.filter((s) => s.type === "feed_per_kg").map((s) => `₹${s.value}/kg from ${s.effectiveFrom}`).join("; "));
for (const m of months) {
  const e = monthEconomics(input, m);
  const bags = input.prod.filter((p) => p.date.startsWith(m)).reduce((t, p) => t + p.feedBags, 0);
  const kind = e.days === dim(m) ? "FULL MONTH" : `TO DATE (${e.days} of ${dim(m)} days have data)`;
  console.log(`\n${m} — ${kind}`);
  console.log(`  feed        ₹${inr(e.cost.feed)}   (${inr(bags)} bags × 45 kg × ₹33.33/kg)`);
  console.log(`  labour      ₹${inr(e.cost.labour)}   ${e.missing.includes("labour") ? "NOT ENTERED" : ""}`);
  console.log(`  electricity ₹${inr(e.cost.electricity)}   ${e.missing.some((x) => x.startsWith("electricity")) ? "NOT ENTERED" : ""}`);
  console.log(`  packing     ₹${inr(e.cost.packing)}`);
  console.log(`  chick       ₹${inr(e.cost.chicks)}`);
  console.log(`  diesel / medicines / other: ${["diesel", "medicines", "other costs"].map((k) => (e.missing.some((x) => x.startsWith(k)) ? `${k} NOT ENTERED` : `${k} entered`)).join(", ")}`);
  console.log(`  TOTAL so far ₹${inr(e.cost.total)}   revenue ₹${inr(e.revenue)}   profit ₹${inr(e.profit)} ${e.missing.length ? "(INCOMPLETE: " + e.missing.join(", ") + ")" : ""}`);
}
await pool.end();
