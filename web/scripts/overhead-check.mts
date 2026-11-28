// V19 D: the owner's average overheads (28 Nov 2026) on the exported real rows.   npx tsx scripts/overhead-check.mts <fixture-dir>
// Expected values are worked out by hand from the cost settings, the purchases and the register; never by the engine.
//   electricity_month_default ₹40,000 from 1 Nov 2026 (a month without a bill), diesel_month_default ₹10,000 from
//   1 Aug 2026 (a month without any diesel entry), miscellaneous_month_default ₹30,000 from 1 Aug 2026,
//   medicine_vaccine_in_feed from 28 Nov 2026 (medicines and vaccines inside the feed price).
/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows are untyped JSON dumps */
import { readFileSync } from "node:fs";
import { loadCostFixture, loadInput } from "./fixtureInput.mts";
import { buildCtx } from "../lib/analytics/engine";
import { dayEconomics, monthEconomics, periodEconomics, flockMonthEconomics, type CostInput } from "../lib/costs/engine";
import { partialMonthWords, sourceWords } from "../lib/costs/costWords";
import { makeRange, rangeOf, summarizeRange, type PeriodExtras } from "../lib/analytics/period";
import { buildShare, readShareChoice } from "../lib/export/analytics";

const dir = process.argv[2];
const j = (n: string) => JSON.parse(readFileSync(`${dir}/${n}.json`, "utf8"));
const ctx = buildCtx(loadInput(dir));
const TODAY = "2026-11-28";
const cost: CostInput = loadCostFixture(dir, TODAY);
const dp: any[] = j("dp");
const sf: any[] = j("sales_full");
const extras: PeriodExtras = { sales: sf.map((s) => ({ date: s.date, eggs: s.e, amount: s.a, grade: s.g, channel: s.tt === "sale_farmfresh" ? "farmfresh" : "local" })), deductions: j("deductions"), birdSales: [] };
let bad = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (!cond) bad++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`); };
const near = (name: string, got: number | null | undefined, want: number, tol = 0.005) => ok(name, got != null && Math.abs(got - want) <= tol, `got ${got} want ${want}`);
const setting = (t: string) => cost.settings.find((s) => s.type === t && !s.month);

// ---- the owner's rows as stored ----
ok("the four new rows: electricity average ₹40,000 from 1 Nov, diesel ₹10,000 and miscellaneous ₹30,000 from 1 Aug, medicines in feed from 28 Nov",
  setting("electricity_month_default")?.value === 40000 && setting("electricity_month_default")?.effectiveFrom === "2026-11-01" && setting("diesel_month_default")?.value === 10000 && setting("diesel_month_default")?.effectiveFrom === "2026-08-01"
  && setting("miscellaneous_month_default")?.value === 30000 && setting("miscellaneous_month_default")?.effectiveFrom === "2026-08-01" && setting("medicine_vaccine_in_feed")?.value === 0 && setting("medicine_vaccine_in_feed")?.effectiveFrom === "2026-11-28");
const realDiesel = cost.purchases.filter((p) => p.category === "diesel").concat(cost.diesel.map((d) => ({ date: d.date, category: "diesel", amount: d.amount })));
ok("there IS one real diesel entry (₹29,000 on 29 Oct 2026), so October keeps it and is not given the average", realDiesel.length === 1 && realDiesel[0].date === "2026-10-29" && realDiesel[0].amount === 29000, JSON.stringify(realDiesel));

// ---- D4: November 2026, 1 to 28 Nov (today 28 Nov) ----
const nov = summarizeRange(ctx, cost, extras, makeRange("2026-11-01", "2026-11-28"));
near("1–28 Nov: electricity = ₹40,000 × 28 ÷ 30 = ₹37,333.33 (no bill: the average)", nov.money.cost.electricity, (40000 * 28) / 30, 1e-6);
near("1–28 Nov: diesel = ₹10,000 × 28 ÷ 30 = ₹9,333.33 (no diesel entry: the average)", nov.money.cost.diesel, (10000 * 28) / 30, 1e-6);
near("1–28 Nov: miscellaneous = ₹30,000 × 28 ÷ 30 = ₹28,000", nov.money.cost.miscellaneous, 28000, 1e-6);
near("1–28 Nov: labour = ₹3,50,000 × 28 ÷ 30 = ₹3,26,666.67", nov.money.cost.labour, (350000 * 28) / 30, 1e-6);
const novRows = [...new Set(dp.filter((r) => r.date >= "2026-11-01" && r.date <= "2026-11-28").map((r) => r.date))];
ok(`1–28 Nov: 28 days are costed — the ${novRows.length} days with register rows, plus the days the register missed (20 Nov) and 28 Nov (today, no row yet)`, nov.money.costDays === 28, `${nov.money.costDays} days`);
ok("1–28 Nov: electricity, diesel and miscellaneous are marked 'average'", sourceWords(nov.money.sources, "electricity") === "average ₹40,000 a month" && sourceWords(nov.money.sources, "diesel") === "average ₹10,000 a month" && sourceWords(nov.money.sources, "miscellaneous") === "average ₹30,000 a month");
const novMonth = summarizeRange(ctx, cost, extras, rangeOf("month", "2026-11-01"));
ok("the November month view (1–30 Nov) on 28 Nov counts the days so far: the same 28 ÷ 30", Math.abs(novMonth.money.cost.electricity - (40000 * 28) / 30) < 1e-6 && novMonth.money.costDays === 28);
ok("…and says so: 'November is still running … counted for 28 of its 30 days'", partialMonthWords(novMonth.money.sources, TODAY).some((w) => w.includes("Nov 2026 is still running") && w.includes("28 of its 30 days")), partialMonthWords(novMonth.money.sources, TODAY).join(" | "));
const mNov = monthEconomics(cost, "2026-11");
ok("Purchases & costs, November: the same 28 ÷ 30 for electricity, diesel, miscellaneous and labour", Math.abs(mNov.cost.electricity - (40000 * 28) / 30) < 1e-6 && Math.abs(mNov.cost.diesel - (10000 * 28) / 30) < 1e-6 && Math.abs(mNov.cost.miscellaneous - 28000) < 1e-6 && mNov.costDays === 28 && mNov.daysInMonth === 30);

// ---- October keeps its real bill and its real diesel ----
const oct = monthEconomics(cost, "2026-10");
ok("October: electricity = the bill ₹58,180 (not the average)", Math.abs(oct.cost.electricity - 58180) < 1e-6 && oct.sources.electricity.every((l) => l.source === "bill"), `${oct.cost.electricity}`);
ok("October: diesel = the ₹29,000 entered on 29 Oct (no average added)", Math.abs(oct.cost.diesel - 29000) < 1e-6 && oct.sources.diesel.every((l) => l.source === "entered") && dayEconomics(cost, "2026-10-29").cost.diesel === 29000 && dayEconomics(cost, "2026-10-28").cost.diesel === 0);
near("October: miscellaneous = ₹30,000 (31 of 31 days)", oct.cost.miscellaneous, 30000, 1e-6);

// ---- a day range inside August ----
const aug = summarizeRange(ctx, cost, extras, makeRange("2026-08-10", "2026-08-16"));
near("10–16 Aug: electricity = the August bill ₹1,00,000 × 7 ÷ 31", aug.money.cost.electricity, (100000 * 7) / 31, 1e-6);
near("10–16 Aug: diesel = the average ₹10,000 × 7 ÷ 31 (August has no diesel entry)", aug.money.cost.diesel, (10000 * 7) / 31, 1e-6);
near("10–16 Aug: miscellaneous = ₹30,000 × 7 ÷ 31", aug.money.cost.miscellaneous, (30000 * 7) / 31, 1e-6);
ok("10–16 Aug: electricity says 'bill', diesel says 'average'", sourceWords(aug.money.sources, "electricity").startsWith("bill") && sourceWords(aug.money.sources, "diesel") === "average ₹10,000 a month");

// ---- medicines and vaccines inside the feed price from 28 Nov ----
const d28 = dayEconomics(cost, "2026-11-28", { overheadOnly: true });
ok("28 Nov: medicines and vaccines 'included in feed price' — no cost added and not missing", d28.sources.medicine.source === "in_feed" && d28.cost.medicine === 0 && !d28.missing.some((m) => m.startsWith("medicines")));
ok("before 28 Nov (the row's date): medicines still 'not entered' as before (27 Nov)", dayEconomics(cost, "2026-11-27").missing.includes("medicines for 2026-11"));
ok("1–28 Nov says both: '1–27 Nov: not entered; included in feed price from 28 Nov'", sourceWords(nov.money.sources, "medicine") === "1 Nov–27 Nov: not entered; included in feed price from 28 Nov", sourceWords(nov.money.sources, "medicine"));

// ---- D2: packing ₹4 per tray sold, big and small eggs ----
const both = [...new Set(sf.map((s) => s.date))].filter((d) => d >= "2026-08-01").find((d) => sf.some((s) => s.date === d && s.g === "big") && sf.some((s) => s.date === d && s.g === "small"))!;
const soldBoth = sf.filter((s) => s.date === both).reduce((t, s) => t + (s.e ?? 0), 0);
near(`D2: ${both} (big and small eggs sold): packing = all eggs sold ÷ 30 × ₹4`, dayEconomics(cost, both).cost.packing, (soldBoth / 30) * 4, 1e-6);
const bigOnly = sf.filter((s) => s.date === both && s.g === "big").reduce((t, s) => t + (s.e ?? 0), 0);
ok("…which is more than the big eggs alone (the small eggs' trays are counted)", dayEconomics(cost, both).cost.packing > (bigOnly / 30) * 4 + 1);

// ---- interest, rent, top dressing: not entered (room for top dressing) ----
ok("interest, rent and top dressing: 'not entered' (not ₹0 and not counted as missing)", nov.money.sources.interest.every((l) => l.source === "not_entered") && nov.money.sources.rent.every((l) => l.source === "not_entered") && nov.money.sources.topDressing.every((l) => l.source === "not_entered") && nov.money.cost.interest === 0 && !nov.money.missing.some((m) => /interest|rent|top/.test(m)));
const withTD: CostInput = { ...cost, today: "2026-12-31", settings: [...cost.settings, { type: "top_dressing", value: 3100, effectiveFrom: "2026-12-01", month: "2026-12" }] };
ok("room for top dressing: a TEST ₹3,100 for December is spread ₹100 a day and added to the cost", Math.abs(dayEconomics(withTD, "2026-12-05", { overheadOnly: true }).cost.topDressing - 100) < 1e-9 && dayEconomics(withTD, "2026-12-05", { overheadOnly: true }).sources.topDressing.source === "entered");

// ---- what moved before 1 Nov: only the diesel average (Aug, Sep) and the miscellaneous average (Aug, Sep, Oct) ----
for (const m of ["2026-07", "2026-08", "2026-09", "2026-10"]) {
  const e = monthEconomics(cost, m);
  const bags = dp.filter((r) => r.date.startsWith(m)).reduce((t, r) => t + (r.feed_bags ?? 0), 0);
  const eggsSold = (j("sales") as any[]).filter((s) => s.date.startsWith(m)).reduce((t, s) => t + (s.eggs ?? 0), 0);
  const bill = cost.settings.find((s) => s.type === "electricity_month" && s.month === m)?.value ?? 0;
  const inForce = m >= "2026-08";
  const chicks = (cost.chickBatches ?? []).filter((b) => b.arrival.startsWith(m) && dp.some((r) => r.date === b.arrival)).reduce((t, b) => t + b.count * 52, 0);
  const oldTotal = (inForce ? bags * 45 * 33.33 : 0) + bill + (inForce ? 350000 : 0) + (inForce ? (eggsSold / 30) * 4 : 0) + (m === "2026-10" ? 29000 : 0) + chicks;
  const dieselAvg = inForce && m !== "2026-10" ? 10000 : 0;
  const misc = inForce ? 30000 : 0;
  ok(`${m}: the only change is diesel average ₹${dieselAvg.toLocaleString("en-IN")} + miscellaneous ₹${misc.toLocaleString("en-IN")} (feed, labour, electricity, packing, chicks as before)`, Math.abs(e.cost.total - (oldTotal + dieselAvg + misc)) < 0.01 && Math.abs(e.cost.diesel - (m === "2026-10" ? 29000 : dieselAvg)) < 1e-6 && Math.abs(e.cost.miscellaneous - misc) < 1e-6, `total ₹${e.cost.total.toFixed(2)} = ₹${oldTotal.toFixed(2)} + ₹${(dieselAvg + misc).toLocaleString("en-IN")}; missing now: ${e.missing.join(", ") || "none"}`);
}

// ---- the period engine, the month view, the per-flock month and the share file agree ----
const s28 = summarizeRange(ctx, cost, extras, makeRange("2026-11-01", "2026-11-28"));
near("1–28 Nov: the period's cost = the Purchases & costs month to date", s28.money.cost.total, mNov.cost.total, 0.01);
const fm = flockMonthEconomics(cost, "2026-11");
near("the per-flock November costs add up to the farm's (20 and 28 Nov shared by the birds of the day before)", fm.reduce((t, f) => t + f.cost, 0), mNov.cost.total, 0.01);
const share = buildShare(ctx, cost, extras, readShareChoice(ctx, { view: "month", from: "2026-11-01", to: "2026-11-30" }, TODAY), new Date("2026-11-28T08:00:00Z"));
const costs = share.sheets.find((x) => x.name === "Costs")!;
ok("the share file's Costs sheet has a row for each costed day (28, with 20 and 28 Nov as 'monthly costs only') and adds up to the period", costs.rows.length === 28 && Math.abs(costs.rows.reduce((t, r) => t + (r.total as number), 0) - novMonth.money.cost.total) < 0.01 && String(costs.rows.find((r) => r.date === "2026-11-20")!.src).startsWith("no register rows"), `${costs.rows.length} rows`);
ok("…medicines on 28 Nov are empty with 'included in feed price', interest / rent / top dressing empty (not entered), never 0", costs.rows.find((r) => r.date === "2026-11-28")!.medicine === null && String(costs.rows.find((r) => r.date === "2026-11-28")!.src).includes("medicines included in feed price") && costs.rows.every((r) => r.interest === null && r.rent === null && r.topDressing === null));
const sum = share.sheets.find((x) => x.name === "Summary")!;
ok("…the Summary marks the averages: 'Cost: Electricity' note 'average ₹40,000 a month'; interest empty 'not entered'; medicines empty with both reasons, not 0", String(sum.rows.find((r) => r.measure === "Cost: Electricity")!.note).includes("average ₹40,000 a month") && sum.rows.find((r) => r.measure === "Cost: Interest")!.whole === null && sum.rows.find((r) => r.measure === "Cost: Medicines and vaccines")!.whole === null && String(sum.rows.find((r) => r.measure === "Cost: Medicines and vaccines")!.note).includes("included in feed price from 28 Nov"));
ok("periodEconomics never goes past today (no cost for 29 and 30 Nov)", periodEconomics(cost, "2026-11-01", "2026-11-30").every((e) => e.date <= TODAY));

process.exit(bad ? 1 : 0);
