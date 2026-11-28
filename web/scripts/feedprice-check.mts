// V19: feed cost from the nutritionist's formulas, on the exported real rows.   npx tsx scripts/feedprice-check.mts <fixture-dir>
// Expected values are worked out by hand (plain arithmetic on the raw rows and the five formulas), never by the engine.
// The live register has no 28 Nov 2026 row yet, so the checks that need a day on or after 28 Nov add TEST rows for
// 28 Nov (a copy of each flock's 27 Nov bags and eggs) to the cost input only; nothing is written anywhere.
/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows are untyped JSON dumps */
import { readFileSync } from "node:fs";
import { loadCostSettings, loadFormulations, loadInput } from "./fixtureInput.mts";
import { buildCtx } from "../lib/analytics/engine";
import { BAG_KG, dayEconomics, flockEconomics, flockFeedCosts, flockMonthEconomics, type CostInput } from "../lib/costs/engine";
import { costLines, feedPriceChanges, feedPriceFor, formulationFor, nextFormulationFor, type Formulation } from "../lib/costs/feedPrice";
import { makeRange, rangeOf, shiftRange, summarizeRange, type PeriodExtras } from "../lib/analytics/period";
import { buildShare, readShareChoice } from "../lib/export/analytics";

const dir = process.argv[2];
const j = (n: string) => JSON.parse(readFileSync(`${dir}/${n}.json`, "utf8"));
const engineIn = loadInput(dir);
const ctx = buildCtx(engineIn);
// the same register with the TEST 28 Nov rows (each flock's 27 Nov row copied), for the checks that need that day
const ctxTest = buildCtx({ ...engineIn, prod: [...engineIn.prod, ...engineIn.prod.filter((r) => r.date === "2026-11-27").map((r) => ({ ...r, date: "2026-11-28" }))] });
const dp: any[] = j("dp");
const flocks: any[] = j("flocks");
const sf: any[] = j("sales_full");
const formulations = loadFormulations(dir);
const settings = loadCostSettings(dir);
const labels: Record<string, string> = Object.fromEntries(flocks.map((f) => [f.flock_internal_id, f.display_label]));
const idOf = (l: string) => flocks.find((f) => f.display_label === l)!.flock_internal_id as string;
const prodOf = (rows: any[]) => rows.map((r) => ({ date: r.date, flockId: r.flock_internal_id, eggs: r.eggs_total ?? 0, feedBags: r.feed_bags ?? 0, birds: r.bird_population ?? 0 }));
const extras: PeriodExtras = { sales: sf.map((s) => ({ date: s.date, eggs: s.e, amount: s.a, grade: s.g, channel: s.tt === "sale_farmfresh" ? "farmfresh" : "local" })), deductions: j("deductions"), birdSales: [] };
const base = { purchases: [], diesel: [], sales: j("sales"), birdSales: [] };
const OLD: CostInput = { ...base, settings, prod: prodOf(dp), flockLabels: labels }; // the cost input without the formulas (as before V19)
const NEW: CostInput = { ...base, settings, prod: prodOf(dp), formulations, flockLabels: labels };
// TEST rows for 28 Nov: each flock's 27 Nov row copied (the register has no 28 Nov yet)
const nov27 = dp.filter((r) => r.date === "2026-11-27");
const TEST: CostInput = { ...NEW, prod: [...NEW.prod, ...prodOf(nov27.map((r) => ({ ...r, date: "2026-11-28" })))] };

let bad = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (!cond) bad++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`); };
const near = (name: string, got: number | null | undefined, want: number, tol = 0.005) => ok(name, got != null && Math.abs(got - want) <= tol, `got ${got} want ${want}`);
const F = (code: string) => formulations.find((f) => f.code === code)!;

// ---- the five formulas as loaded ----
ok("five formulas, all from 28 Nov 2026, with the sheds the owner listed", formulations.length === 5 && formulations.every((f) => f.effectiveFrom === "2026-11-28")
  && F("P4_S1_S4").sheds.sort().join() === "BAB-1,BAB-4" && F("P4_S2").sheds.join() === "BAB-2" && F("P3_S3_S5_S6").sheds.sort().join() === "BAB-3,BAB-5,BAB-6"
  && F("P2_S8").sheds.join() === "BAB-8" && F("P1_S9_S10_S11").sheds.sort().join() === "BAB-10,BAB-11,BAB-9");
const want: Record<string, number> = { "BAB-1": 36.027, "BAB-4": 36.027, "BAB-2": 35.394, "BAB-3": 36.161, "BAB-5": 36.161, "BAB-6": 36.161, "BAB-8": 36.691, "BAB-9": 38.438, "BAB-10": 38.438, "BAB-11": 38.438 };
ok("delivered cost per kg per shed = the owner's list (36.027, 35.394, 36.161, 36.691, 38.438)", Object.entries(want).every(([l, v]) => feedPriceFor(settings, formulations, l, "2026-11-28").perKg === v));
for (const f of formulations) {
  const byHand = f.formulaCostPerKg / (1 - f.lossPct / 100) + f.productionCostPerKg + f.baggingCostPerKg;
  ok(`${f.code}: delivered ${f.deliveredCostPerKg} = formula ${f.formulaCostPerKg} ÷ 0.99 + 1.50 + 0.90 (${byHand.toFixed(4)}), and the card's lines add up to it exactly`, Math.abs(byHand - f.deliveredCostPerKg) < 0.001 && Math.abs(costLines(f).reduce((t, l) => t + l.perKg, 0) - f.deliveredCostPerKg) < 1e-9);
  const pct = f.ingredients.reduce((t, i) => t + i.percent, 0);
  ok(`${f.code}: ${f.ingredients.length} ingredients add up to 100 % and 1,000 kg`, Math.abs(pct - 100) < 0.01 && Math.abs(f.ingredients.reduce((t, i) => t + i.kgPerBatch, 0) - 1000) < 0.02, `${pct.toFixed(3)} %`);
}

// ---- A1: the price for (flock, day) and where it came from ----
const p28 = feedPriceFor(settings, formulations, "BAB-1", "2026-11-28");
const p27 = feedPriceFor(settings, formulations, "BAB-1", "2026-11-27");
ok("BAB-1 on 28 Nov: 36.027, 'Formula: BV-300 Phase IV shed 1 & 4'", p28.perKg === 36.027 && p28.source === "formula" && p28.label === "Formula: BV-300 Phase IV shed 1 & 4", p28.label);
ok("BAB-1 on 27 Nov: the farm default 33.33, 'Farm default 33.33'", p27.perKg === 33.33 && p27.source === "default" && p27.label === "Farm default 33.33", p27.label);
const p7 = feedPriceFor(settings, formulations, "BAB-7", "2026-11-28");
ok("BAB-7 (no formula yet) on 28 Nov: the farm default 33.33", p7.perKg === 33.33 && p7.source === "default" && nextFormulationFor(formulations, "BAB-7", "2026-11-28") === null);
ok("the shed names are matched whatever the case or spaces ('bab-1 ')", feedPriceFor(settings, formulations, " bab-1 ", "2026-11-28").perKg === 36.027);
ok("a flock that left (Old BAB-1, sold Sep) is not BAB-1: farm default", feedPriceFor(settings, formulations, "Old BAB-1 (sold Sep)", "2026-11-28").source === "default");
ok("no formula and no farm default: 'not entered', price null (never 0)", (() => { const x = feedPriceFor([], formulations, "BAB-7", "2026-11-28"); return x.perKg === null && x.source === "missing" && x.label === "not entered"; })());
ok("before 28 Nov the board says what is coming: BAB-1 on 27 Nov, next = Phase IV shed 1 & 4 from 28 Nov", nextFormulationFor(formulations, "BAB-1", "2026-11-27")?.code === "P4_S1_S4");

// ---- B4: a later formula row is picked up with no code change ----
const later: Formulation = { ...F("P4_S1_S4"), id: 99, code: "TEST_LATER", name: "TEST later formula", effectiveFrom: "2026-12-15", deliveredCostPerKg: 37.5 };
const withLater = [...formulations, later];
ok("a new formula row from 15 Dec for BAB-1 and BAB-4: used from 15 Dec, the old one until 14 Dec, no code change", formulationFor(withLater, "BAB-1", "2026-12-14")?.code === "P4_S1_S4" && formulationFor(withLater, "BAB-1", "2026-12-15")?.code === "TEST_LATER" && feedPriceFor(settings, withLater, "BAB-4", "2026-12-20").perKg === 37.5 && feedPriceFor(settings, withLater, "BAB-2", "2026-12-20").perKg === 35.394);
ok("a changed farm default (e.g. ₹34 from 1 Dec) only moves the sheds without a formula", (() => { const s2 = [...settings, { type: "feed_per_kg", value: 34, effectiveFrom: "2026-12-01", month: null }]; return feedPriceFor(s2, formulations, "BAB-7", "2026-12-02").perKg === 34 && feedPriceFor(s2, formulations, "BAB-1", "2026-12-02").perKg === 36.027 && feedPriceFor(s2, formulations, "BAB-7", "2026-11-30").perKg === 33.33; })());

// ---- A2: daily feed cost per flock = bags × 45 × that flock's price; the farm = the sum over flocks ----
ok("the bag weight is the one setting BAG_KG = 45 kg", BAG_KG === 45);
const b1 = idOf("BAB-1");
const fe28 = flockEconomics(TEST, "2026-11-28").find((x) => x.flockId === b1)!;
ok("TEST row: BAB-1 on 28 Nov with 16 bags = 16 × 45 × 36.027 = ₹25,939.44", fe28.feedBags === 16 ? Math.abs(fe28.feed - 25939.44) < 1e-6 : Math.abs(fe28.feed - fe28.feedBags * 45 * 36.027) < 1e-6, `${fe28.feedBags} bags → ₹${fe28.feed.toFixed(2)}`);
const fe27 = flockEconomics(NEW, "2026-11-27").find((x) => x.flockId === b1)!;
ok("real row: BAB-1 on 27 Nov uses 33.33 (16 bags = 16 × 45 × 33.33 = ₹23,997.60)", fe27.feedBags === 16 ? Math.abs(fe27.feed - 23997.6) < 1e-6 : Math.abs(fe27.feed - fe27.feedBags * 45 * 33.33) < 1e-6, `${fe27.feedBags} bags → ₹${fe27.feed.toFixed(2)}`);
const b7 = idOf("BAB-7");
const fe7 = flockEconomics(TEST, "2026-11-28").find((x) => x.flockId === b7)!;
ok("TEST row: BAB-7 on 28 Nov falls back to the farm default (bags × 45 × 33.33)", Math.abs(fe7.feed - fe7.feedBags * 45 * 33.33) < 1e-6 && fe7.price.source === "default", `${fe7.feedBags} bags → ₹${fe7.feed.toFixed(2)}`);
const priceOf = (label: string, d: string) => (d >= "2026-11-28" && want[label] != null ? want[label] : 33.33);
const byHandDay = (rows: any[], d: string) => rows.filter((r) => r.date === d && (r.feed_bags ?? 0) > 0).reduce((t, r) => t + r.feed_bags * 45 * priceOf(labels[r.flock_internal_id], d), 0);
const t28 = nov27.map((r) => ({ ...r, date: "2026-11-28" }));
near("TEST 28 Nov: the farm's feed cost = the sum over the flocks of bags × 45 × each flock's price (by hand)", dayEconomics(TEST, "2026-11-28").cost.feed, byHandDay(t28, "2026-11-28"), 1e-6);
const oneDefault = t28.reduce((t, r) => t + (r.feed_bags ?? 0), 0) * 45 * 33.33;
ok("…and it is not all bags × one price", Math.abs(dayEconomics(TEST, "2026-11-28").cost.feed - oneDefault) > 1000, `₹${dayEconomics(TEST, "2026-11-28").cost.feed.toFixed(2)} vs ₹${oneDefault.toFixed(2)}`);
// A4: BAB-9, 10, 11 (their bags are in the register now) are in the cost
const young = ["BAB-9", "BAB-10", "BAB-11"].map(idOf);
const y28 = flockEconomics(TEST, "2026-11-28").filter((x) => young.includes(x.flockId));
ok("A4: BAB-9, BAB-10 and BAB-11 have a feed cost at 38.438 on 28 Nov, and it is inside the farm total", y28.length === 3 && y28.every((x) => x.feedBags > 0 && Math.abs(x.feed - x.feedBags * 45 * 38.438) < 1e-6) && dayEconomics(TEST, "2026-11-28").feedBy.some((g) => g.perKg === 38.438 && g.bags === y28.reduce((t, x) => t + x.feedBags, 0)));
const y27 = flockEconomics(NEW, "2026-11-27").filter((x) => young.includes(x.flockId));
ok("A4: on 27 Nov (real rows) the three young flocks' bags are costed at 33.33 too", y27.every((x) => x.feedBags > 0 && Math.abs(x.feed - x.feedBags * 45 * 33.33) < 1e-6), y27.map((x) => x.feedBags).join("+") + " bags");

// ---- the mixed week 22–28 Nov ----
const wk = makeRange("2026-11-22", "2026-11-28");
const sWk = summarizeRange(ctxTest, TEST, extras, wk);
const wkRows = [...dp.filter((r) => r.date >= "2026-11-22" && r.date <= "2026-11-27"), ...t28];
const wkByHand = [...new Set(wkRows.map((r) => r.date))].reduce((t, d) => t + byHandDay(wkRows, d), 0);
near("mixed week 22–28 Nov (28 Nov = TEST rows): feed cost = 22–27 Nov at 33.33 + 28 Nov at each shed's price, by hand", sWk.money.cost.feed, wkByHand, 1e-4);
const fp = dp.filter((r) => r.date >= "2026-11-22" && r.date <= "2026-11-27").reduce((t, r) => t + (r.feed_bags ?? 0), 0);
const same27 = nov27.map((r) => `${labels[r.flock_internal_id]}:${r.feed_bags}`).sort().join(" ") === "BAB-1:16 BAB-10:23 BAB-11:20 BAB-2:25 BAB-3:27 BAB-4:26 BAB-5:26 BAB-6:16 BAB-7:4 BAB-8:26 BAB-9:22".split(" ").sort().join(" ");
if (fp === 1367 && same27) {
  // by hand on 28 Nov 2026 from the live rows: 1,367 bags 22–27 Nov × 45 × 33.33 = 2,050,294.95;
  // 28 Nov (27 Nov copied): 45 × (42 × 36.027 + 25 × 35.394 + 69 × 36.161 + 26 × 36.691 + 65 × 38.438 + 4 × 33.33) = 381,548.205
  near("mixed week, the hand-worked figure from the live rows: ₹20,50,294.95 + ₹3,81,548.21 = ₹24,31,843.16", sWk.money.cost.feed, 2431843.155, 0.01);
} else console.log(`SKIP  the hand-worked ₹24,31,843.16 week: the live rows of 22–27 Nov have changed since 28 Nov (${fp} bags); the by-hand check above still ran`);
ok("mixed week: the period says 'Feed price changed on 28 Nov 2026'", sWk.money.feedPriceChanges.join() === "2026-11-28" && feedPriceChanges(formulations, "2026-11-01", "2026-11-27").length === 0 && feedPriceChanges(formulations, "2026-11-28", "2026-11-30").length === 0);
ok("mixed week: one line per price (the farm default for 22–27 Nov and BAB-7, then the five formulas)", sWk.money.feedBy.length === 6 && sWk.money.feedBy.find((g) => g.perKg === 33.33)!.bags === fp + 4 && sWk.money.feedBy.filter((g) => g.label.startsWith("Formula: ")).length === 5);
const eggsWk = sWk.eggs.total;
near("A3: cost per egg uses the new feed cost (total cost ÷ eggs)", sWk.money.costPerEgg, sWk.money.cost.total / eggsWk, 1e-9);
// the per-flock month uses each day's own price too
const fmNov = flockMonthEconomics(TEST, "2026-11").find((x) => x.flockId === b1)!;
const b1Rows = [...dp.filter((r) => r.flock_internal_id === b1 && r.date.startsWith("2026-11")), ...t28.filter((r) => r.flock_internal_id === b1)];
near("BAB-1, November per flock: 1–27 Nov at 33.33 + the TEST 28 Nov at 36.027", fmNov.feed, b1Rows.reduce((t, r) => t + (r.feed_bags ?? 0) * 45 * (r.date >= "2026-11-28" ? 36.027 : 33.33), 0), 1e-6);

// ---- A5: nothing silently estimated ----
const NOPRICE: CostInput = { ...TEST, settings: settings.filter((s) => s.type !== "feed_per_kg") };
const e28 = dayEconomics(NOPRICE, "2026-11-28");
ok("no farm default: BAB-7 (no formula) is 'not entered' — flagged missing, never ₹0 — and the other sheds keep their formula price", e28.feedNotPriced.join() === "BAB-7" && e28.missing.includes("feed price per kg") && Math.abs(e28.cost.feed - (byHandDay(t28, "2026-11-28") - nov27.find((r) => r.flock_internal_id === b7)!.feed_bags * 45 * 33.33)) < 1e-6);
ok("…its flock line says not entered (feedMissing) and its 7-day shed cost is empty, not 0", flockEconomics(NOPRICE, "2026-11-28").find((x) => x.flockId === b7)!.feedMissing && flockFeedCosts(NOPRICE, ["2026-11-28"]).find((x) => x.flockId === b7)!.cost === null);

// ---- B3: feed cost by shed over the last 7 days ----
const last7 = [...new Set(dp.map((r) => r.date))].sort().slice(-7);
const shed = flockFeedCosts(NEW, last7);
ok("B3: each shed's 7-day cost = its bags × 45 × each day's price; the sheds add up to the farm", shed.every((x) => x.cost != null && Math.abs(x.cost - dp.filter((r) => r.flock_internal_id === x.flockId && last7.includes(r.date)).reduce((t, r) => t + (r.feed_bags ?? 0) * 45 * priceOf(labels[r.flock_internal_id], r.date), 0)) < 1e-6)
  && Math.abs(shed.reduce((t, x) => t + (x.cost ?? 0), 0) - last7.reduce((t, d) => t + dayEconomics(NEW, d).cost.feed, 0)) < 1e-6, `${last7[0]} – ${last7[6]}`);
ok("B3: cost per egg = the shed's feed cost ÷ its eggs", shed.every((x) => x.eggs === 0 || Math.abs((x.costPerEgg ?? 0) - x.cost! / x.eggs) < 1e-12));

// ---- C2: no number moves before 28 Nov ----
const days = [...new Set(dp.map((r) => r.date))].filter((d) => d < "2026-11-28").sort();
let feedSame = 0, daySame = 0, flockSame = 0;
for (const d of days) {
  const bags = dp.filter((r) => r.date === d).reduce((t, r) => t + (r.feed_bags ?? 0), 0);
  const a = dayEconomics(NEW, d);
  const o = dayEconomics(OLD, d);
  // exactly the pre-V19 expression: all the day's bags × 45 × the farm default in force (none before 1 Aug: 0 and "missing")
  const def = settings.filter((x) => x.type === "feed_per_kg" && !x.month && x.effectiveFrom <= d).sort((x, y) => (x.effectiveFrom < y.effectiveFrom ? 1 : -1))[0]?.value ?? 0;
  if (a.cost.feed === bags * 45 * def && (def > 0 || bags === 0 || a.missing.includes("feed price per kg"))) feedSame++;
  if (JSON.stringify(a) === JSON.stringify(o)) daySame++;
  const noPrice = (xs: ReturnType<typeof flockEconomics>) => JSON.stringify(xs.map((x) => ({ ...x, price: x.price.perKg })));
  if (noPrice(flockEconomics(NEW, d)) === noPrice(flockEconomics(OLD, d))) flockSame++;
}
ok(`C2: every day before 28 Nov (${days.length} days): the farm's feed cost is exactly all bags × 45 × the farm default (33.33 from 1 Aug; before that "not entered"), as before`, feedSame === days.length, `${feedSame}/${days.length}`);
ok("C2: every day before 28 Nov: the whole day (every cost, profit, cost per egg, missing list) is identical with and without the formulas", daySame === days.length, `${daySame}/${days.length}`);
ok("C2: every day before 28 Nov: each flock's feed, cost, revenue and profit are identical", flockSame === days.length, `${flockSame}/${days.length}`);
let sums = 0, sumSame = 0;
const strip = (x: any) => { const c = JSON.parse(JSON.stringify(x)); delete c.money.feedPriceChanges; return c; };
for (const kind of ["week", "month", "year"] as const) {
  for (let r = rangeOf(kind, "2026-06-29"); r.from <= "2026-11-27"; r = shiftRange(r, 1)) {
    for (const seg of ["all", "main", "young"] as const) {
      sums++;
      const a = summarizeRange(ctx, NEW, extras, r, { segment: seg });
      const o = summarizeRange(ctx, OLD, extras, r, { segment: seg });
      if (JSON.stringify(strip(a)) === JSON.stringify(strip(o))) sumSame++;
    }
    if (kind === "year") break;
  }
}
for (const l of ["BAB-3", "BAB-9", "Old BAB-1 (sold Sep)"]) {
  sums++;
  const r = makeRange("2026-08-01", "2026-11-27");
  if (JSON.stringify(summarizeRange(ctx, NEW, extras, r, { flocks: [idOf(l)] })) === JSON.stringify(summarizeRange(ctx, OLD, extras, r, { flocks: [idOf(l)] }))) sumSame++;
}
ok(`C2: every week, month and the year × whole farm / main / young, and three flocks, up to 27 Nov: identical (${sums} summaries; only the "price changed on 28 Nov" note is new where a period runs past it)`, sumSame === sums, `${sumSame}/${sums}`);
const shareOld = buildShare(ctx, OLD, extras, readShareChoice(ctx, { view: "custom", from: "2026-11-13", to: "2026-11-27" }, "2026-11-28"), new Date("2026-11-28T08:00:00Z"));
const shareNew = buildShare(ctx, NEW, extras, readShareChoice(ctx, { view: "custom", from: "2026-11-13", to: "2026-11-27" }, "2026-11-28"), new Date("2026-11-28T08:00:00Z"));
ok("C2: the V18 share file for 13–27 Nov (Summary, Days, Costs …) has exactly the same numbers", JSON.stringify(shareOld.sheets.map((s) => s.rows)) === JSON.stringify(shareNew.sheets.map((s) => s.rows)));
const shareMixed = buildShare(ctxTest, TEST, extras, readShareChoice(ctx, { view: "custom", from: "2026-11-22", to: "2026-11-28" }, "2026-11-28"), new Date("2026-11-28T08:00:00Z"));
const costsMixed = shareMixed.sheets.find((s) => s.name === "Costs")!;
near("the share file for 22–28 Nov (TEST 28 Nov): the Costs sheet's feed = the mixed week by hand", costsMixed.rows.reduce((t, r) => t + (r.feed as number), 0), wkByHand, 1e-4);
ok("…and it says 'Feed price changed on 28 Nov 2026 (new formulas)' and which price each day used", costsMixed.notes.some((n) => n.startsWith("Feed price changed on 28 Nov 2026 (new formulas)")) && String(costsMixed.rows.find((r) => r.date === "2026-11-28")!.feedPrice).includes("BV-300 Phase I shed 9, 10 & 11 ₹38.438/kg"));

process.exit(bad ? 1 : 0);
