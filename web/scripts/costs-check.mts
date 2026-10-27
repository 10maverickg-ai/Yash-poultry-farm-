// Cost/profit engine on exported real rows: node scripts/costs-check.mts <fixture-dir>
/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows are untyped JSON dumps */
import { readFileSync } from "node:fs";
import { monthEconomics, dayEconomics, type CostInput } from "../lib/costs/engine.ts";
const dir = process.argv[2];
const j = (n: string) => JSON.parse(readFileSync(`${dir}/${n}.json`, "utf8"));
const input: CostInput = {
  settings: [
    { type: "feed_per_kg", value: 30, effectiveFrom: "2026-08-01", month: null },
    { type: "labour_month", value: 250000, effectiveFrom: "2026-08-01", month: null },
    { type: "packing_per_tray", value: 4, effectiveFrom: "2026-08-01", month: null },
    { type: "electricity_month", value: 100000, effectiveFrom: "2026-08-01", month: "2026-08" },
  ],
  purchases: [], diesel: [],
  prod: j("dp").map((r: any) => ({ date: r.date, flockId: r.flock_internal_id, eggs: r.eggs_total ?? 0, feedBags: r.feed_bags ?? 0, birds: r.bird_population ?? 0 })),
  sales: j("sales"),
  birdSales: [],
};
let bad = 0;
const check = (name: string, got: number, want: number, tol = 0.5) => { const ok = Math.abs(got - want) <= tol; if (!ok) bad++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}: ${got.toFixed(2)} (want ${want})`); };
const aug = monthEconomics(input, "2026-08");
const augBags = input.prod.filter((p) => p.date.startsWith("2026-08")).reduce((s, p) => s + p.feedBags, 0);
console.log("Aug:", { days: aug.days, eggsProduced: aug.eggsProduced, eggsSold: aug.eggsSold, revenue: Math.round(aug.revenue), cost: Object.fromEntries(Object.entries(aug.cost).map(([k, v]) => [k, Math.round(v as number)])), profit: Math.round(aug.profit), revenuePerEgg: aug.revenuePerEgg?.toFixed(3), costPerEgg: aug.costPerEgg?.toFixed(3), missing: aug.missing });
check("feed = bags x 45 x 30", aug.cost.feed, augBags * 45 * 30);
check("electricity month total", aug.cost.electricity, 100000);
check("labour month total", aug.cost.labour, 250000);
check("packing = eggs sold / 30 x 4", aug.cost.packing, (aug.eggsSold / 30) * 4);
const augSales = (j("sales") as { date: string; amount: number | null }[]).filter((x) => x.date.startsWith("2026-08")).reduce((t, x) => t + (x.amount ?? 0), 0);
check("revenue = sum of the August sales amounts in the export", aug.revenue, augSales, 0.05);
check("profit = revenue - cost", aug.profit, aug.revenue - aug.cost.total);
const sep = monthEconomics(input, "2026-09");
console.log("Sep missing:", sep.missing, "electricity counted as", Math.round(sep.cost.electricity));
check("Sep electricity is 0 (not entered), never guessed", sep.cost.electricity, 0);
const d = dayEconomics(input, "2026-08-10");
console.log("Aug 10:", { sold: d.eggsSold, revenue: Math.round(d.revenue), cost: Math.round(d.cost.total), perEgg: d.revenuePerEgg?.toFixed(2) });
process.exit(bad ? 1 : 0);
