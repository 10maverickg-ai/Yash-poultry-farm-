// V18 A5: the shared Analytics file on the exported real rows.   npx tsx scripts/share-check.mts <fixture-dir>
// The file must say what the screen says: every total is checked against the period engine the screen renders
// (summarizeRange), the totals rows are recalculated by LibreOffice when it is installed (no formula errors),
// and a file without the money blocks must not carry a single word or ₹ about sales, cost or profit.
/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows are untyped JSON dumps */
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { loadInput } from "./fixtureInput.mts";
import { buildCtx } from "../lib/analytics/engine";
import { makeRange, summarizeRange, type PeriodExtras } from "../lib/analytics/period";
import type { CostInput } from "../lib/costs/engine";
import { buildShare, generatedIST, readShareChoice, type ShareFile } from "../lib/export/analytics";
import { BLOCKS, cannotShare, incParam, parseInc, shareFileStem, shareQuery, sheetsFor, type Block } from "../lib/export/shareOptions";
import { buildBook, buildCsv, buildCsvZip } from "../lib/export/build";
import type { Dataset } from "../lib/export/types";

const dir = process.argv[2];
const j = (n: string) => JSON.parse(readFileSync(`${dir}/${n}.json`, "utf8"));
const ctx = buildCtx(loadInput(dir));
const sf: any[] = j("sales_full");
const cost: CostInput = {
  settings: [
    { type: "feed_per_kg", value: 30, effectiveFrom: "2026-08-01", month: null },
    { type: "labour_month", value: 250000, effectiveFrom: "2026-08-01", month: null },
    { type: "packing_per_tray", value: 4, effectiveFrom: "2026-08-01", month: null },
  ],
  purchases: [], diesel: [],
  prod: j("dp").map((r: any) => ({ date: r.date, flockId: r.flock_internal_id, eggs: r.eggs_total ?? 0, feedBags: r.feed_bags ?? 0, birds: r.bird_population ?? 0 })),
  sales: j("sales"),
  birdSales: [],
};
const extras: PeriodExtras = {
  sales: sf.map((s) => ({ date: s.date, eggs: s.e, amount: s.a, grade: s.g, channel: s.tt === "sale_farmfresh" ? "farmfresh" : "local" })),
  deductions: j("deductions"),
  birdSales: [],
};
const NOW = new Date("2026-11-28T08:35:00Z"); // 14:05 IST
const TODAY = "2026-11-28";

let bad = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (!cond) bad++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`); };
const near = (name: string, got: unknown, want: number | null | undefined, tol = 1e-6) => ok(name, typeof got === "number" && want != null && Math.abs(got - want) <= tol, `got ${got} want ${want}`);
const share = (sp: Record<string, string | string[]>) => buildShare(ctx, cost, extras, readShareChoice(ctx, sp, TODAY), NOW);
const sheet = (f: ShareFile, n: string) => f.sheets.find((s) => s.name === n)!;
const col = (ds: Dataset, k: string) => ds.rows.map((r) => r[k]);
const sum = (xs: unknown[]) => xs.reduce<number>((t, x) => t + (typeof x === "number" ? x : 0), 0);
const cell = (ds: Dataset, measure: string, key: string) => ds.rows.find((r) => r.measure === measure)?.[key];
/** Every piece of text in the file: the lines on top, titles, headers, cells and notes of every sheet. */
const allText = (f: ShareFile) => [...f.meta, ...f.sheets.flatMap((s) => [s.name, s.title, ...s.columns.map((c) => c.header), ...s.rows.flatMap((r) => Object.values(r).map((v) => String(v ?? ""))), ...s.notes])].join("\n");
const MONEY_WORDS = /sale|sold|revenue|cost|profit|₹|price|rupee|amount/i;
const has = (d: string) => ctx.dates.includes(d);

// ---- 6–19 Nov, only Production and Feed ----
if (has("2026-11-06") && has("2026-11-19")) {
  const f = share({ view: "custom", from: "2026-11-06", to: "2026-11-19", inc: "production,feed" });
  ok("6–19 Nov, Production + Feed only: one sheet, Summary (the two tables were not ticked)", f.sheets.map((s) => s.name).join() === "Summary" && sheetsFor(["production", "feed"], { farmLevel: true, compare: false }).join() === "Summary");
  const blocks = new Set(col(sheet(f, "Summary"), "what"));
  ok("6–19 Nov: the Summary has only Production and Feed intake rows", blocks.size === 2 && blocks.has("Production") && blocks.has("Feed intake"), [...blocks].join(", "));
  const m = MONEY_WORDS.exec(allText(f));
  ok("6–19 Nov: no sales, cost or profit anywhere in the file (lines on top, headers, cells, notes)", !m, m ? `found "${m[0]}"` : "");
  const s = summarizeRange(ctx, cost, extras, makeRange("2026-11-06", "2026-11-19"));
  const S = sheet(f, "Summary");
  ok("6–19 Nov: Summary eggs and feed bags = the screen's engine (whole farm)", cell(S, "Eggs", "whole") === s.eggs.total && cell(S, "Feed (bags)", "whole") === s.feed.bags, `${cell(S, "Eggs", "whole")} eggs, ${cell(S, "Feed (bags)", "whole")} bags`);
  near("6–19 Nov: Summary FCR = the screen's engine", cell(S, "FCR (estimated from standard egg weight)", "whole"), s.feed.fcrEstimated);

  const g = share({ view: "custom", from: "2026-11-06", to: "2026-11-19", inc: "production,feed,flocks,days" });
  const D = sheet(g, "Days");
  const want = ["date", "eggs", "trays", "birddays", "hd", "feed", "feedKg", "feedBirds", "gBird", "eggsFed", "eggsPerKg", "gEgg", "fcrKg", "eggKg", "fcr", "fcrStd", "note"];
  ok("6–19 Nov with the tables: the Days sheet has exactly the production and feed columns (no deaths, no money)", D.columns.map((c) => c.key).join() === want.join(), D.columns.map((c) => c.key).join());
  const F = sheet(g, "Flocks");
  ok("6–19 Nov: the Flocks sheet has no deaths and no money columns", !F.columns.some((c) => ["deaths", "deathsPct", "birdsEnd", "revenue", "cost", "profit"].includes(c.key)));
  const gm = MONEY_WORDS.exec(allText(g));
  ok("6–19 Nov with the tables: still no sales, cost or profit anywhere", !gm, gm ? `found "${gm[0]}"` : "");
  ok("6–19 Nov: Days eggs and feed add up to the Summary and the screen", sum(col(D, "eggs")) === s.eggs.total && sum(col(D, "feed")) === s.feed.bags && sum(col(sheet(g, "Flocks"), "eggs")) === s.eggs.total);
}

// ---- 13–19 Nov, whole farm, everything ticked ----
const W = share({ view: "week", from: "2026-11-13", to: "2026-11-19" });
const sw = summarizeRange(ctx, cost, extras, makeRange("2026-11-13", "2026-11-19"));
{
  ok("13–19 Nov whole farm, everything ticked: Summary, Flocks, Days, Sales, Costs, Alerts (= what the panel promises)", W.sheets.map((s) => s.name).join() === "Summary,Flocks,Days,Sales,Costs,Alerts" && sheetsFor([...BLOCKS], { farmLevel: true, compare: false }).join() === W.sheets.map((s) => s.name).join());
  const S = sheet(W, "Summary");
  const D = sheet(W, "Days");
  const F = sheet(W, "Flocks");
  ok("13–19 Nov: Days eggs = Summary eggs = the screen's engine", sum(col(D, "eggs")) === cell(S, "Eggs", "whole") && cell(S, "Eggs", "whole") === sw.eggs.total, `${sum(col(D, "eggs"))} / ${cell(S, "Eggs", "whole")} / ${sw.eggs.total}`);
  ok("13–19 Nov: Days feed bags and deaths = Summary = engine", sum(col(D, "feed")) === sw.feed.bags && cell(S, "Feed (bags)", "whole") === sw.feed.bags && sum(col(D, "deaths")) === sw.birds.deaths && cell(S, "Deaths", "whole") === sw.birds.deaths);
  ok("13–19 Nov: Flocks eggs and deaths add up to the whole farm", sum(col(F, "eggs")) === sw.eggs.total && sum(col(F, "deaths")) === sw.birds.deaths);
  near("13–19 Nov: Days revenue = Summary revenue = engine", sum(col(D, "revenue")), sw.money.revenue, 0.005);
  near("13–19 Nov: Sales sheet amounts = engine revenue", sum(col(sheet(W, "Sales"), "amount")), sw.money.revenue, 0.005);
  near("13–19 Nov: Days cost = Costs sheet total = Summary total cost = engine", sum(col(D, "cost")), sw.money.cost.total, 0.005);
  near("13–19 Nov: Costs sheet (sum of every part) = engine", sum(col(sheet(W, "Costs"), "total")), sw.money.cost.total, 0.005);
  near("13–19 Nov: Summary profit = engine (an estimate)", cell(S, "Profit (estimate: egg revenue − cost)", "whole"), sw.money.profit, 0.005);
  ok("13–19 Nov: Alerts rows = the Summary's alert count = engine", sheet(W, "Alerts").rows.length === sw.alerts.total && cell(S, "Alerts raised", "whole") === sw.alerts.total, `${sw.alerts.total}`);
  const pooledFcr = sum(col(D, "fcrKg")) / sum(col(D, "eggKg"));
  near("13–19 Nov: FCR pooled from the Days columns (feed kg ÷ egg kg) = Summary = engine", pooledFcr, sw.feed.fcrEstimated);
  near("13–19 Nov: eggs per kg pooled from Days = engine", sum(col(D, "eggsFed")) / sum(col(D, "feedKg")), sw.feed.eggsPerKg);
  near("13–19 Nov: feed g per egg × eggs per kg = 1000 (exact, the same totals)", (cell(S, "Feed g per egg (exact)", "whole") as number) * (cell(S, "Eggs per kg of feed", "whole") as number), 1000);
  const ms = summarizeRange(ctx, cost, extras, makeRange("2026-11-13", "2026-11-19"), { segment: "main" });
  ok("13–19 Nov: the Main column = the Main block on the screen", cell(S, "Eggs", "main") === ms.eggs.total && cell(S, "Feed (bags)", "main") === ms.feed.bags);
  ok("13–19 Nov: money is whole-farm only: Main and Young cells are empty with the reason", cell(S, "Egg revenue (priced sales)", "main") == null && /whole farm only/.test(String(cell(S, "Egg revenue (priced sales)", "note"))));
  ok("13–19 Nov: the lines on top: farm, view, dates, flocks, generated time IST, 'Profit is an estimate'", W.meta[0] === "Yash Poultry Farm" && W.meta[1] === "View: Week" && /^Dates: 13 Nov – 19 Nov 2026 \(7 days; 7 of 7 days have data\)$/.test(W.meta[2]) && W.meta[3] === "Flocks: All flocks" && W.meta.includes("Generated 28 Nov 2026, 14:05 IST") && W.meta.includes("Profit is an estimate."), W.meta.join(" | "));
  ok("13–19 Nov: HD % is a real percentage (a fraction shown with a % format), never a number like 75", D.columns.find((c) => c.key === "hd")?.type === "percent" && col(D, "hd").every((v) => typeof v === "number" && v > 0 && v < 1) && S.percentCells!(S.rows.findIndex((r) => r.measure === "HD % (all eggs ÷ all bird-days)"), "whole") === true);
  ok("CSV: percentages are written × 100 (74.85, not 0.7485)", buildCsv(S, W.meta).includes(`,${(Math.round((sw.eggs.hdPooled! / 100) * 10000) / 100).toString()},`));
  ok("file name: yash-poultry-week-2026-11-13_2026-11-19", W.stem === "yash-poultry-week-2026-11-13_2026-11-19" && shareFileStem("compare", "2026-11-01", "2026-11-19") === "yash-poultry-compare-2026-11-01_2026-11-19");
  ok("generated time is the farm's (IST): 08:35 UTC = 14:05 IST, 20:00 UTC = 01:30 IST next day", generatedIST(NOW) === "Generated 28 Nov 2026, 14:05 IST" && generatedIST(new Date("2026-11-28T20:00:00Z")) === "Generated 29 Nov 2026, 01:30 IST");
}

// ---- 13–19 Nov, one flock ----
{
  const f = share({ view: "flock", from: "2026-11-13", to: "2026-11-19", f: "BAB-9" });
  const id = [...ctx.flockById.values()].find((x) => x.label === "BAB-9")!.id;
  const s = summarizeRange(ctx, cost, extras, makeRange("2026-11-13", "2026-11-19"), { flocks: [id] });
  const S = sheet(f, "Summary");
  const D = sheet(f, "Days");
  ok("BAB-9 13–19 Nov, everything ticked: no Sales and no Costs sheet (farm-level), and the file says why", f.sheets.map((x) => x.name).join() === "Summary,Flocks,Days,Alerts" && f.meta.some((m) => /kept for the whole farm, not per flock/.test(m)) && !f.meta.includes("Profit is an estimate."));
  ok("BAB-9: Days eggs = Summary eggs = the screen's engine for that flock", sum(col(D, "eggs")) === cell(S, "Eggs", "chosen") && cell(S, "Eggs", "chosen") === s.eggs.total, `${s.eggs.total}`);
  ok("BAB-9: Days feed and deaths = Summary = engine", sum(col(D, "feed")) === s.feed.bags && sum(col(D, "deaths")) === s.birds.deaths && cell(S, "Deaths", "chosen") === s.birds.deaths);
  near("BAB-9: FCR pooled from Days = Summary = engine", sum(col(D, "fcrKg")) / sum(col(D, "eggKg")), s.feed.fcrEstimated);
  const noFeed = D.rows.filter((r) => r.feed == null);
  ok("BAB-9: a day with no feed figure stays EMPTY (never 0) and says 'feed not recorded'", noFeed.length > 0 && noFeed.every((r) => r.feedKg == null && r.eggsPerKg == null && r.fcr == null && /feed not recorded/.test(String(r.note))), `${noFeed.length} day(s)`);
  ok("BAB-9: no cell anywhere is about sales, cost or profit", !/revenue|profit|₹/i.test(f.sheets.flatMap((x) => [...x.columns.map((c) => c.header), ...x.rows.flatMap((r) => Object.values(r).map(String))]).join("\n")));
}

// ---- a young flock's group figure that does not exist is empty with the reason ----
{
  const S = sheet(W, "Summary");
  ok("Young column: 'feed days left' is empty with the reason (stock is kept for the main flocks), never 0", cell(S, "Feed days left at the end (stock ÷ use)", "young") == null && /main flocks/.test(String(cell(S, "Feed days left at the end (stock ÷ use)", "note"))));
}

// ---- a range with no data ----
{
  const last = ctx.dates[ctx.dates.length - 1];
  const from = new Date(Date.parse(last + "T00:00:00Z") + 2 * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(Date.parse(last + "T00:00:00Z") + 8 * 86_400_000).toISOString().slice(0, 10);
  const f = share({ view: "custom", from, to });
  ok(`no data (${from} to ${to}): one sheet that says so, nothing filled in as zero`, f.noData && f.sheets.length === 1 && /No data in these dates/.test(String(f.sheets[0].rows[0].what)) && /Nothing is filled in as zero/.test(String(f.sheets[0].rows[0].note)) && /no data in this period/.test(f.meta[2]));
}

// ---- 366 days ----
{
  const t = Date.now();
  const f = share({ view: "custom", from: "2025-11-20", to: "2026-11-20" });
  const ms = Date.now() - t;
  const days = ctx.dates.filter((d) => d >= "2025-11-20" && d <= "2026-11-20").length;
  ok("366-day range: builds, every day with data is a row, under 10 s", readShareChoice(ctx, { from: "2025-11-20", to: "2026-11-20" }, TODAY).range.days === 366 && sheet(f, "Days").rows.length >= days && ms < 10_000, `${sheet(f, "Days").rows.length} rows (${days} days with data), ${ms} ms`);
  const s = summarizeRange(ctx, cost, extras, makeRange("2025-11-20", "2026-11-20"));
  ok("366-day range: Days eggs = Summary = engine", sum(col(sheet(f, "Days"), "eggs")) === s.eggs.total && cell(sheet(f, "Summary"), "Eggs", "whole") === s.eggs.total);
  near("366-day range: Days revenue (sale-only days included) = engine", sum(col(sheet(f, "Days"), "revenue")), s.money.revenue, 0.01);
  ok("367 days asked: capped at 366 with a note", (() => { const c = readShareChoice(ctx, { from: "2025-11-19", to: "2026-11-20" }, TODAY); return c.range.days === 366 && c.notes.some((n) => /at most 366/.test(n)); })());
}

// ---- every block on its own: the sheets match the panel's promise; money never sneaks in ----
for (const farm of [true, false]) {
  for (const b of BLOCKS) {
    const f = share({ view: "custom", from: "2026-11-13", to: "2026-11-19", inc: b, ...(farm ? {} : { f: "BAB-5" }) });
    const why = cannotShare([b], { farmLevel: farm, compare: false });
    if (why) continue;
    const names = f.sheets.map((s) => s.name).join();
    const promised = sheetsFor([b], { farmLevel: farm, compare: false }).join();
    // "Birds sold" (a bird count in Mortality and birds) and the alert "Eggs are piling up unsold" are not money
    const money = !(["sales", "costs"] as Block[]).includes(b) && MONEY_WORDS.exec(allText(f).replace(/Birds sold|unsold/g, ""));
    ok(`only "${b}" (${farm ? "all flocks" : "BAB-5"}): sheets ${names} = promised; ${["sales", "costs"].includes(b) ? "money only as ticked" : "no money words"}`, names === promised && !money, money ? `found "${money[0]}"` : "");
  }
}
ok("only Sales and Costs with a chosen flock: refused with the reason (they are whole-farm only)", /whole farm/.test(cannotShare(["sales", "costs"], { farmLevel: false, compare: false }) ?? ""));
ok("nothing ticked: refused with the reason", /Nothing is ticked/.test(cannotShare([], { farmLevel: true, compare: false }) ?? ""));
ok("the address: no inc = everything; inc= = nothing; inc=production,feed round-trips", parseInc(undefined).length === BLOCKS.length && parseInc("").length === 0 && incParam(parseInc("feed,production")) === "production,feed" && /inc=production%2Cfeed/.test(shareQuery({ view: "week", from: "2026-11-16", to: "2026-11-22", inc: ["production", "feed"] })));

// ---- Compare with only Production and Feed ----
{
  const f = share({ view: "compare", a: "BAB-9", af: "2026-11-13", at: "2026-11-19", b: "BAB-10", bf: "2026-11-13", bt: "2026-11-19", inc: "production,feed" });
  const groups = new Set(col(f.sheets[0], "group"));
  ok("Compare, Production + Feed: one Compare sheet with Dates, Age, Eggs, Hen-housed, Egg ledger and Feed rows only", f.sheets.length === 1 && f.sheets[0].name === "Compare" && [...groups].every((g) => ["Dates", "Age", "Eggs", "Hen-housed", "Egg ledger", "Feed"].includes(String(g))) && groups.has("Feed") && !groups.has("Birds"), [...groups].join(", "));
  const m = MONEY_WORDS.exec(allText(f));
  ok("Compare, Production + Feed: no sales, cost or profit anywhere", !m, m ? `found "${m[0]}"` : "");
  ok("Compare file name: yash-poultry-compare-<earliest>_<latest>", f.stem === "yash-poultry-compare-2026-11-13_2026-11-19");
}

// ---- the real files: Excel layout, CSV zip, LibreOffice recalculation ----
const out = mkdtempSync(join(tmpdir(), "share-check-"));
{
  const buf = await buildBook(W.sheets, W.meta);
  writeFileSync(join(out, "week.xlsx"), buf);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.getWorksheet("Days")!;
  const headerRow = W.meta.length + 3;
  ok("Excel: one sheet per block, the header row is frozen, the first lines are the farm and the view", wb.worksheets.map((s) => s.name).join() === "Summary,Flocks,Days,Sales,Costs,Alerts" && (ws.views[0] as { ySplit?: number }).ySplit === headerRow && ws.getRow(headerRow).getCell(1).value === "Date" && ws.getRow(1).getCell(1).value === "Yash Poultry Farm" && ws.getRow(2).getCell(1).value === "View: Week");
  const dateCell = ws.getRow(headerRow + 1).getCell(1).value;
  const hdCell = ws.getRow(headerRow + 1).getCell(5);
  const eggsTotal = ws.getRow(headerRow + 1 + sheet(W, "Days").rows.length).getCell(2).value as { formula?: string };
  ok("Excel: real dates, HD % as a formula with a % format, totals as SUM formulas", dateCell instanceof Date && typeof (hdCell.value as { formula?: string }).formula === "string" && hdCell.numFmt === "0.0%" && /^SUM\(B\d+:B\d+\)$/.test(eggsTotal?.formula ?? ""), `${(hdCell.value as { formula?: string }).formula} ${hdCell.numFmt} ${eggsTotal?.formula}`);
  const zip = await JSZip.loadAsync(await buildCsvZip(W.sheets, W.meta, W.stem));
  const names = Object.keys(zip.files).sort();
  const days = await zip.file(`${W.stem}-days.csv`)!.async("string");
  ok("CSV: one file per sheet in a zip, each starting with the lines about the file", names.length === 6 && names.every((n) => n.startsWith(W.stem)) && days.replace(/^﻿/, "").startsWith("Yash Poultry Farm\r\nView: Week\r\n"), names.join(", "));
  const one = share({ view: "custom", from: "2026-11-13", to: "2026-11-19", inc: "production" });
  ok("CSV: a choice with one table (Production only = the Summary) is one sheet, sent as one plain .csv (no zip)", one.sheets.length === 1 && one.sheets[0].name === "Summary" && buildCsv(one.sheets[0], one.meta).replace(/^\uFEFF/, "").startsWith("Yash Poultry Farm\r\n"));
  ok("a table with nothing to fill it (Day-by-day or Per-flock alone) is refused with the reason, never an empty table", /needs something in it/.test(cannotShare(["days"], { farmLevel: true, compare: false }) ?? "") && /needs something in it/.test(cannotShare(["flocks", "days"], { farmLevel: false, compare: false }) ?? "") && sheetsFor(["days", "sales"], { farmLevel: true, compare: false }).join() === "Summary,Days,Sales");
}

const soffice = ["/usr/bin/soffice", "/usr/bin/libreoffice", "/opt/libreoffice/program/soffice"].find((p) => existsSync(p));
if (!soffice) console.log("SKIP  LibreOffice is not installed here: the recalculation check did not run");
else {
  for (const [name, f] of [["week", W], ["flock", share({ view: "flock", from: "2026-11-13", to: "2026-11-19", f: "BAB-9" })], ["year", share({ view: "custom", from: "2025-11-20", to: "2026-11-20" })], ["compare", share({ view: "compare", a: "BAB-9", af: "2026-11-13", at: "2026-11-19", b: "all", bf: "2026-11-13", bt: "2026-11-19" })]] as const) {
    writeFileSync(join(out, `${name}.xlsx`), await buildBook(f.sheets, f.meta));
  }
  const conv = join(out, "recalc");
  const r = spawnSync(soffice, ["--headless", "--calc", "--convert-to", "xlsx", "--outdir", conv, ...["week", "flock", "year", "compare"].map((n) => join(out, `${n}.xlsx`))], { encoding: "utf8", timeout: 180_000 });
  ok("LibreOffice opens and recalculates the four files (week, one flock, 366 days, Compare)", r.status === 0 && ["week", "flock", "year", "compare"].every((n) => existsSync(join(conv, `${n}.xlsx`))), (r.stderr ?? "").slice(0, 120));
  let errors = 0;
  const seen: string[] = [];
  for (const n of ["week", "flock", "year", "compare"]) {
    if (!existsSync(join(conv, `${n}.xlsx`))) continue;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(join(conv, `${n}.xlsx`));
    wb.eachSheet((ws) => ws.eachRow((row) => row.eachCell((c) => {
      const v = c.value as { result?: unknown; error?: string } | string | null;
      const res = v && typeof v === "object" && "result" in v ? v.result : v;
      const txt = res && typeof res === "object" && "error" in (res as object) ? String((res as { error: string }).error) : String(res ?? "");
      if (/^#(DIV\/0!|VALUE!|REF!|NAME\?|N\/A|NUM!|NULL!)$|^Err:\d+$/.test(txt)) { errors++; if (seen.length < 3) seen.push(`${n}/${ws.name}!${c.address} ${txt}`); }
    })));
  }
  ok("after recalculation: no formula errors in any cell of any sheet", errors === 0, seen.join("; "));
  // the recalculated totals row of Days = the Summary = the engine
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(join(conv, "week.xlsx"));
  const ws = wb.getWorksheet("Days")!;
  const D = sheet(W, "Days");
  const tot = ws.getRow(W.meta.length + 3 + D.rows.length + 1);
  const at = (k: string) => { const v = tot.getCell(D.columns.findIndex((c) => c.key === k) + 1).value as { result?: number } | number; return typeof v === "number" ? v : v?.result; };
  ok("recalculated Days totals: eggs = engine", at("eggs") === sw.eggs.total, `${at("eggs")}`);
  near("recalculated Days totals: HD % (pooled) = engine", at("hd"), sw.eggs.hdPooled! / 100);
  near("recalculated Days totals: FCR (pooled) = engine", at("fcr"), sw.feed.fcrEstimated);
  near("recalculated Days totals: eggs per kg (pooled) = engine", at("eggsPerKg"), sw.feed.eggsPerKg);
  near("recalculated Days totals: profit = revenue − cost = engine", at("profit"), sw.money.profit, 0.01);
}

process.exit(bad ? 1 : 0);
