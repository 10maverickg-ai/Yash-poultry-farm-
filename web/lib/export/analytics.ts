// V18 A2: the shared Analytics file. PURE (no database, no framework): the route loads the data and calls this,
// and the tests call it on the fixture rows, so the file is checked against the same engine as the screen.
// Every number comes from the period engine (summarizeRange) or the same row helpers the screen uses; the Compare
// sheet is the V15 Compare sheet with only the ticked groups. Missing values stay empty with the reason beside them.
import { alertsFor, breedName, rowsOn, SEGMENT_NAME, segmentOn, type Ctx, type ProdRow, type SegFilter } from "@/lib/analytics/engine";
import { fcrOf } from "@/lib/analytics/fcr";
import { makeRange, summarizeRange, type PeriodExtras, type PeriodRange, type PeriodSummary } from "@/lib/analytics/period";
import { readRange, one, type Param } from "@/lib/analytics/rangeParams";
import { compareRows, compareSide, readCompare, type CompareRow, type CompareState } from "@/lib/analytics/compare";
import { chip } from "@/lib/analytics/chips";
import { KIND_TITLE } from "@/lib/analytics/today";
import { BAG_KG, dayEconomics, type CostInput } from "@/lib/costs/engine";
import { dmy } from "@/lib/format";
import { compareSheet, HD_NOTE } from "./compareSheet";
import { BLOCK_LABEL, BLOCKS, parseInc, SHARE_VIEWS, shareFileStem, VIEW_LABEL, type Block, type ShareView } from "./shareOptions";
import type { Col, Dataset } from "./types";

export interface ShareChoice {
  view: ShareView;
  range: PeriodRange; // Compare: from the earlier start to the later end of A and B (for the file name)
  flockIds: string[]; // empty = all flocks
  flockLabels: string[];
  inc: Block[];
  notes: string[]; // dates swapped, future left out, an unknown flock …
  compare: CompareState | null;
}

/** The choice from the address (the share page and the file read it the same way). */
export function readShareChoice(ctx: Ctx, sp: Record<string, Param>, today: string): ShareChoice {
  const v = one(sp.view) as ShareView | undefined;
  const view: ShareView = v && SHARE_VIEWS.includes(v) ? v : "custom";
  const inc = parseInc(sp.inc);
  if (view === "compare") {
    const st = readCompare(ctx, sp, today);
    const from = st.a.range.from < st.b.range.from ? st.a.range.from : st.b.range.from;
    const to = st.a.range.to > st.b.range.to ? st.a.range.to : st.b.range.to;
    return { view, range: makeRange(from, to), flockIds: [], flockLabels: [], inc, notes: [], compare: st };
  }
  const rc = readRange(ctx, { from: sp.from, to: sp.to, f: sp.f }, today);
  return { view, range: rc.range, flockIds: rc.flockIds, flockLabels: rc.flockLabels, inc, notes: rc.notes, compare: null };
}

/** "Generated 28 Nov 2026, 14:05 IST" (the farm's time, whatever the server's clock zone). */
export function generatedIST(now: Date): string {
  const t = new Date(now.getTime() + 5.5 * 3600 * 1000).toISOString();
  return `Generated ${dmy(t.slice(0, 10))}, ${t.slice(11, 16)} IST`;
}

type Cell = string | number | null;
interface Def extends Col {
  value: (i: number) => Cell;
  formula?: (row: number, L: Record<string, string>, i: number) => string | null;
}
const colLetter = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colLetter(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)));

/** A table from column definitions: values row by row, formulas that can name any column by its key. */
function table(name: string, title: string, defs: Def[], n: number, notes: string[]): Dataset {
  const L = Object.fromEntries(defs.map((d, i) => [d.key, colLetter(i)]));
  const rows = Array.from({ length: n }, (_, i) => Object.fromEntries(defs.map((d) => [d.key, d.value(i)])));
  const formulas: NonNullable<Dataset["formulas"]> = {};
  for (const d of defs) if (d.formula) formulas[d.key] = (row, i) => d.formula!(row, L, i);
  const columns: Col[] = defs.map((d) => ({ key: d.key, header: d.header, type: d.type, width: d.width, total: d.total, totalFormula: d.totalFormula }));
  return { name, title, columns, rows, notes, formulas };
}
const sumF = (k: string) => (f: number, l: number, L: Record<string, string>) => `SUM(${L[k]}${f}:${L[k]}${l})`;
/** A pooled ratio for the totals row: SUM(top) × k ÷ SUM(bottom), empty when the bottom is 0. */
const poolF = (top: string, bottom: string, k = 1) => (f: number, l: number, L: Record<string, string>) =>
  `IF(SUM(${L[bottom]}${f}:${L[bottom]}${l})>0,SUM(${L[top]}${f}:${L[top]}${l})${k !== 1 ? `*${k}` : ""}/SUM(${L[bottom]}${f}:${L[bottom]}${l}),"")`;
/** The same ratio in one row: top × k ÷ bottom, empty when either is missing or the bottom is 0. */
const rowRatio = (top: string, bottom: string, k = 1) => (r: number, L: Record<string, string>) =>
  `IF(AND(ISNUMBER(${L[top]}${r}),ISNUMBER(${L[bottom]}${r}),${L[bottom]}${r}>0),${L[top]}${r}${k !== 1 ? `*${k}` : ""}/${L[bottom]}${r},"")`;

const FEED_NOTE = `Feed kg = bags × ${BAG_KG} kg. Feed figures, eggs per kg, feed per egg and FCR use only the flock-days that have a feed figure ("feed not recorded" days are left out, never counted as 0).`;
const FCR_NOTE = "FCR = feed kg ÷ egg kg (lower is better). Egg kg = eggs × the BV300 standard egg weight for the flock's age (estimated), unless a real weighing is stored; flock-days with no egg-weight reference are left out on both sides. Pooled: all feed kg ÷ all egg kg, never an average of daily FCRs.";
const MONEY_NOTE = "Revenue = priced egg sales only. Cost and profit are ESTIMATES (feed exact; electricity, labour and packing spread; diesel and medicines on the day bought). Missing inputs are missing, not zero.";

interface Ctxs {
  ctx: Ctx;
  cost: CostInput;
  extras: PeriodExtras;
  c: ShareChoice;
  has: (b: Block) => boolean;
  farm: boolean; // all flocks (sales and costs exist only for the whole farm)
  seg: SegFilter;
  only: ReadonlySet<string> | undefined;
  who: string;
}

// ---- Summary ----------------------------------------------------------------------------------------------------
type Kind = "int" | "num" | "ratio" | "percent" | "date" | "text";
interface SumRow {
  block: Block;
  measure: string;
  unit: string;
  kind: Kind;
  get: (s: PeriodSummary, col: string) => { v: Cell; why?: string | null };
}

function summaryRows(x: Ctxs): SumRow[] {
  const out: SumRow[] = [];
  const add = (block: Block, measure: string, unit: string, kind: Kind, get: SumRow["get"]) => { if (x.has(block)) out.push({ block, measure, unit, kind, get }); };
  const FN = "feed not recorded on these days";
  const fed = (s: PeriodSummary) => s.feed.recorded;
  const farmOnly = (col: string) => (col === "main" || col === "young" ? "kept for the whole farm only, not split by group" : null);
  // production
  add("production", "Days with data", "days", "int", (s) => ({ v: s.daysWithData }));
  add("production", "Eggs", "eggs", "int", (s) => ({ v: s.eggs.total }));
  add("production", "Trays (30 eggs)", "trays", "num", (s) => ({ v: s.eggs.trays }));
  add("production", "Eggs per day (days with data)", "eggs", "num", (s) => ({ v: s.eggs.perDay, why: "no data" }));
  add("production", "Bird-days (birds counted each day, added up)", "bird-days", "int", (s) => ({ v: s.series.reduce((t, p) => t + p.birds, 0) }));
  add("production", "HD % (all eggs ÷ all bird-days)", "%", "percent", (s) => ({ v: s.eggs.hdPooled != null ? s.eggs.hdPooled / 100 : null, why: "no birds counted" }));
  add("production", "Best day HD %", "%", "percent", (s) => ({ v: s.eggs.best ? s.eggs.best.hd / 100 : null, why: "no data" }));
  add("production", "Best day", "date", "date", (s) => ({ v: s.eggs.best?.date ?? null, why: "no data" }));
  add("production", "Lowest day HD %", "%", "percent", (s) => ({ v: s.eggs.worst ? s.eggs.worst.hd / 100 : null, why: "no data" }));
  add("production", "Lowest day", "date", "date", (s) => ({ v: s.eggs.worst?.date ?? null, why: "no data" }));
  add("production", "Breakage (egg ledger)", "eggs", "int", (s) => (s.farmLevel ? { v: s.eggs.breakage } : { v: null, why: "the egg ledger is farm-level, not split by flock" }));
  add("production", "Breakage, % of eggs laid", "%", "percent", (s) => (s.farmLevel ? { v: s.eggs.breakagePct != null ? s.eggs.breakagePct / 100 : null, why: "no eggs" } : { v: null, why: "the egg ledger is farm-level, not split by flock" }));
  // feed
  add("feed", "Days with feed", "days", "int", (s) => ({ v: s.feed.daysRecorded }));
  add("feed", "Feed (bags)", "bags", "int", (s) => (fed(s) ? { v: s.feed.bags } : { v: null, why: FN }));
  add("feed", `Feed kg (bags × ${BAG_KG} kg)`, "kg", "num", (s) => (fed(s) ? { v: s.feed.kg } : { v: null, why: FN }));
  add("feed", "Average bags a day (days with feed)", "bags", "num", (s) => ({ v: s.feed.bagsPerDay, why: FN }));
  add("feed", "Feed g per bird a day", "g", "num", (s) => ({ v: s.feed.gPerBirdDay, why: FN }));
  add("feed", "Eggs per kg of feed", "eggs", "ratio", (s) => ({ v: s.feed.eggsPerKg, why: s.feed.eggsPerKgWhy ?? FN }));
  add("feed", "Feed g per egg (exact)", "g", "num", (s) => ({ v: s.feed.feedPerEggG, why: FN }));
  add("feed", "FCR (estimated from standard egg weight)", "kg feed ÷ kg eggs", "ratio", (s) => ({ v: s.feed.fcrEstimated, why: s.feed.fcrWhy ?? FN }));
  add("feed", "Breeder's FCR for the same flocks and days (BV300)", "kg feed ÷ kg eggs", "ratio", (s) => ({ v: s.feed.standardFcr, why: s.feed.fcrWhy ?? "no book figure for these flock-days" }));
  add("feed", "FCR gap (FCR − breeder's; positive = more feed per kg of eggs)", "", "ratio", (s) => ({ v: s.feed.fcrGap, why: s.feed.fcrWhy ?? "no book figure" }));
  add("feed", "Feed days left at the end (stock ÷ use)", "days", "num", (s, col) => (s.feed.daysLeftAtEnd != null ? { v: s.feed.daysLeftAtEnd } : { v: null, why: col === "young" ? "feed stock is kept for the main flocks" : s.farmLevel ? "no feed stock figure" : "feed stock is farm-level, not split by flock" }));
  // mortality
  add("mortality", "Birds at start", "birds", "int", (s) => ({ v: s.birds.opening, why: "no data" }));
  add("mortality", "Birds at end (last day with data)", "birds", "int", (s) => ({ v: s.birds.closing, why: "no data" }));
  add("mortality", "Deaths", "birds", "int", (s) => ({ v: s.birds.deaths }));
  add("mortality", "Deaths, % of birds at start", "%", "percent", (s) => ({ v: s.birds.deathsPct != null ? s.birds.deathsPct / 100 : null, why: "birds at start not known" }));
  add("mortality", "Deaths per 1,000 birds", "per 1,000", "num", (s) => ({ v: s.birds.deathsPer1000, why: "birds at start not known" }));
  add("mortality", "Birds sold", "birds", "int", (s) => ({ v: s.birds.soldOut }));
  add("mortality", "Birds moved out (to another flock)", "birds", "int", (s) => ({ v: s.birds.anilOut }));
  add("mortality", "Birds moved in", "birds", "int", (s) => ({ v: s.birds.anilIn }));
  add("mortality", "Other count changes", "birds", "int", (s) => ({ v: s.birds.otherAdjust }));
  // sales (whole farm only)
  if (x.farm) {
    add("sales", "Eggs sold", "eggs", "int", (s, col) => (farmOnly(col) ? { v: null, why: farmOnly(col) } : { v: s.money.eggsSold }));
    add("sales", "Eggs sold with no rate entered", "eggs", "int", (s, col) => (farmOnly(col) ? { v: null, why: farmOnly(col) } : { v: s.money.unpricedEggs }));
    add("sales", "Egg revenue (priced sales)", "₹", "num", (s, col) => (farmOnly(col) ? { v: null, why: farmOnly(col) } : { v: s.money.revenue }));
    add("sales", "Average price per priced egg", "₹", "num", (s, col) => (farmOnly(col) ? { v: null, why: farmOnly(col) } : { v: s.money.avgPricePerEgg, why: "no priced sales" }));
    add("sales", "Bird sales", "₹", "num", (s, col) => (farmOnly(col) ? { v: null, why: farmOnly(col) } : { v: s.money.birdSaleRevenue }));
    // costs (whole farm only)
    const parts: [keyof PeriodSummary["money"]["cost"], string][] = [["feed", "Feed"], ["electricity", "Electricity (spread)"], ["labour", "Labour (spread)"], ["packing", "Packing"], ["diesel", "Diesel (day bought)"], ["medicine", "Medicines (day bought)"], ["other", "Other"], ["chicks", "Chicks"]];
    for (const [k, l] of parts) add("costs", `Cost: ${l}`, "₹", "num", (s, col) => (farmOnly(col) ? { v: null, why: farmOnly(col) } : { v: s.money.cost[k] }));
    add("costs", "Total cost so far (estimate)", "₹", "num", (s, col) => (farmOnly(col) ? { v: null, why: farmOnly(col) } : { v: s.money.cost.total, why: null }));
    add("costs", "Profit (estimate: egg revenue − cost)", "₹", "num", (s, col) => (farmOnly(col) ? { v: null, why: farmOnly(col) } : { v: s.money.profit, why: "no priced egg sales in these dates" }));
    add("costs", "Cost per egg laid (estimate)", "₹", "num", (s, col) => (farmOnly(col) ? { v: null, why: farmOnly(col) } : { v: s.money.costPerEgg, why: "no eggs" }));
    add("costs", "Profit per tray sold (estimate)", "₹", "num", (s, col) => (farmOnly(col) ? { v: null, why: farmOnly(col) } : { v: s.money.profitPerTray, why: "no priced egg sales" }));
    add("costs", "Cost inputs missing (counted as missing, not zero)", "", "text", (s, col) => (farmOnly(col) ? { v: null, why: farmOnly(col) } : { v: s.money.missing.length ? s.money.missing.join(", ") : "none" }));
  }
  // alerts
  add("alerts", "Alerts raised", "alerts", "int", (s) => ({ v: s.alerts.total }));
  return out;
}

function summarySheet(x: Ctxs, cols: { key: string; header: string; short: string; s: PeriodSummary }[]): Dataset {
  const rows = summaryRows(x);
  // one line per alert kind that happened, after the total
  if (x.has("alerts")) {
    const kinds = [...new Set(cols.flatMap((c) => Object.keys(c.s.alerts.byKind)))] as (keyof PeriodSummary["alerts"]["byKind"])[];
    for (const k of kinds) rows.push({ block: "alerts", measure: /^[a-z]/.test(KIND_TITLE[k]) ? `Alerts: a flock ${KIND_TITLE[k]}` : `Alerts: ${KIND_TITLE[k]}`, unit: "alerts", kind: "int", get: (s) => ({ v: s.alerts.byKind[k] ?? 0 }) });
  }
  const defs: Def[] = [
    { key: "what", header: "Block", type: "text", width: 16, value: (i) => BLOCK_LABEL[rows[i].block].replace(/ \(.*\)$/, "") },
    { key: "measure", header: "Measure", type: "text", width: 46, value: (i) => rows[i].measure },
    ...cols.map((c): Def => ({ key: c.key, header: c.header, type: "auto", width: 18, value: (i) => rows[i].get(c.s, c.key).v })),
    { key: "unit", header: "Unit", type: "text", width: 14, value: (i) => rows[i].unit },
    {
      key: "note",
      header: "Why blank / note",
      type: "text",
      width: 60,
      value: (i) => {
        // one reason per blank cell, said once: "Main and Young: kept for the whole farm only"
        const by = new Map<string, string[]>();
        for (const c of cols) {
          const g = rows[i].get(c.s, c.key);
          if (g.v == null && g.why) by.set(g.why, [...(by.get(g.why) ?? []), c.short]);
        }
        if (by.size === 0) return null;
        if (by.size === 1 && [...by.values()][0].length === cols.length) return [...by.keys()][0];
        return [...by].map(([why, names]) => `${names.join(" and ")}: ${why}`).join("; ");
      },
    },
  ];
  const ds = table("Summary", `Summary — ${x.c.range.label} — ${x.who}`, defs, rows.length, summaryNotes(x, cols.map((c) => c.s)));
  const valueKeys = new Set(cols.map((c) => c.key));
  ds.percentCells = (ri, key) => valueKeys.has(key) && rows[ri].kind === "percent";
  ds.ratioCells = (ri, key) => valueKeys.has(key) && rows[ri].kind === "ratio";
  return ds;
}

function summaryNotes(x: Ctxs, ss: PeriodSummary[]): string[] {
  const s = ss[ss.length - 1];
  const notes = [`${x.c.range.label}: ${s.dataNote}. Every figure is for these dates; averages use only the days with data.`];
  if (x.farm) notes.push("Main flocks and Young flocks are worked out on their own rows; the Whole farm column is the sum of the groups (its HD % mixes mature and young birds).");
  else notes.push(`${x.who}: their own rows only (their birds, eggs, deaths and feed).`);
  if (x.has("production")) notes.push(HD_NOTE.replace(" The totals row pools it (total eggs ÷ total bird-days);", " Pooled:"));
  if (x.has("feed")) {
    notes.push(FEED_NOTE, FCR_NOTE);
    for (const z of ss) if (z.feed.fcrLeftOut) notes.push(`FCR: ${z.feed.fcrLeftOut}.`);
  }
  if (x.farm && (x.has("sales") || x.has("costs"))) notes.push(MONEY_NOTE);
  return [...new Set(notes)];
}

// ---- Flocks -----------------------------------------------------------------------------------------------------
function flocksSheet(x: Ctxs, s: PeriodSummary): Dataset {
  const fl = s.flocks;
  const rowsOf = (id: string): ProdRow[] => (x.ctx.byFlock.get(id) ?? []).filter((r) => r.date >= x.c.range.from && r.date <= x.c.range.to && (x.seg === "all" || segmentOn(x.ctx, r.flockId, r.date) === x.seg));
  const rs = fl.map((f) => rowsOf(f.flockId));
  const fed = rs.map((r) => r.filter((z) => z.feed != null));
  const fcr = rs.map((r) => fcrOf(x.ctx, r));
  const sum = (xs: ProdRow[], k: "eggs" | "pop" | "feed" | "mort") => xs.reduce((t, r) => t + (r[k] ?? 0), 0);
  const defs: Def[] = [
    { key: "flock", header: "Flock", type: "text", width: 12, value: (i) => fl[i].label },
    { key: "group", header: "Group", type: "text", width: 10, value: (i) => { const g = segmentOn(x.ctx, fl[i].flockId, rs[i][rs[i].length - 1].date); return g ? (g === "main" ? "main" : "young") : "not set"; } },
    { key: "breed", header: "Breed", type: "text", width: 10, value: (i) => fl[i].breed || breedName(null) },
    { key: "days", header: "Days with data", type: "int", width: 9, value: (i) => fl[i].days },
  ];
  if (x.has("production")) {
    defs.push(
      { key: "eggs", header: "Eggs", type: "int", width: 11, total: true, value: (i) => fl[i].eggs },
      { key: "birddays", header: "Bird-days", type: "int", width: 12, total: true, value: (i) => sum(rs[i], "pop") },
      { key: "hd", header: "HD % (eggs ÷ bird-days)", type: "percent", width: 11, value: (i) => (fl[i].hd != null ? fl[i].hd! / 100 : null), formula: rowRatio("eggs", "birddays"), totalFormula: poolF("eggs", "birddays") },
      { key: "share", header: "Share of the eggs", type: "percent", width: 10, value: (i) => (fl[i].shareOfEggs != null ? fl[i].shareOfEggs! / 100 : null) },
      { key: "std", header: "Breeder's HD % (age at the end)", type: "percent", width: 12, value: (i) => (fl[i].stdHd != null ? fl[i].stdHd! / 100 : null) },
      { key: "gap", header: "Points below the breeder's HD %", type: "num", width: 12, value: (i) => fl[i].gap },
      { key: "status", header: "Against our realistic target", type: "text", width: 20, value: (i) => chip(fl[i]).label },
      { key: "hh", header: "Hen-housed % (eggs ÷ hens housed)", type: "percent", width: 12, value: (i) => (fl[i].henHousedPct != null ? fl[i].henHousedPct! / 100 : null) },
      { key: "housed", header: "Hens housed (average)", type: "int", width: 11, value: (i) => fl[i].hensHoused },
      { key: "housedSrc", header: "Hens housed from", type: "text", width: 14, value: (i) => (fl[i].housedSource === "standin" ? "stand-in (2 Jul count)" : fl[i].housedSource ?? null) },
    );
  }
  if (x.has("feed")) {
    defs.push(
      { key: "daysFed", header: "Days with feed", type: "int", width: 9, value: (i) => fl[i].daysWithFeed },
      { key: "feed", header: "Feed (bags)", type: "int", width: 10, total: true, value: (i) => (fed[i].length ? sum(fed[i], "feed") : null) },
      { key: "feedKg", header: `Feed kg (bags × ${BAG_KG})`, type: "num", width: 11, value: (i) => (fed[i].length ? sum(fed[i], "feed") * BAG_KG : null), formula: (r, L) => `IF(ISNUMBER(${L.feed}${r}),${L.feed}${r}*${BAG_KG},"")`, totalFormula: sumF("feedKg") },
      { key: "feedBirds", header: "Bird-days with feed", type: "int", width: 12, total: true, value: (i) => (fed[i].length ? sum(fed[i], "pop") : null) },
      { key: "gBird", header: "Feed g per bird a day", type: "num", width: 10, value: (i) => fl[i].feedGPerBird, formula: rowRatio("feedKg", "feedBirds", 1000), totalFormula: poolF("feedKg", "feedBirds", 1000) },
      { key: "eggsFed", header: "Eggs on days with feed", type: "int", width: 12, total: true, value: (i) => (fed[i].length ? sum(fed[i], "eggs") : null) },
      { key: "eggsPerKg", header: "Eggs per kg of feed", type: "num", width: 10, value: (i) => fl[i].eggsPerKgFeed, formula: rowRatio("eggsFed", "feedKg"), totalFormula: poolF("eggsFed", "feedKg") },
      { key: "gEgg", header: "Feed g per egg (exact)", type: "num", width: 10, value: (i) => fl[i].feedPerEggG, formula: rowRatio("feedKg", "eggsFed", 1000), totalFormula: poolF("feedKg", "eggsFed", 1000) },
      { key: "fcrKg", header: "Feed kg in the FCR (flock-days with an egg weight)", type: "num", width: 13, total: true, value: (i) => (fcr[i].eggKg > 0 ? fcr[i].fcrFeedKg : null) },
      { key: "eggKg", header: "Egg kg (eggs × standard egg weight)", type: "num", width: 13, total: true, value: (i) => (fcr[i].eggKg > 0 ? fcr[i].eggKg : null) },
      { key: "fcr", header: "FCR (estimated from standard egg weight)", type: "num", width: 12, value: (i) => fl[i].fcrEstimated, formula: rowRatio("fcrKg", "eggKg"), totalFormula: poolF("fcrKg", "eggKg") },
      { key: "fcrStd", header: "Breeder's FCR, same days", type: "num", width: 11, value: (i) => fl[i].standardFcr },
      { key: "fcrGap", header: "FCR gap (positive = worse)", type: "num", width: 11, value: (i) => fl[i].fcrGap, formula: (r, L, i) => (fl[i].fcrEstimated != null && fl[i].standardFcr != null ? `IF(AND(ISNUMBER(${L.fcr}${r}),ISNUMBER(${L.fcrStd}${r})),${L.fcr}${r}-${L.fcrStd}${r},"")` : null) },
    );
  }
  if (x.has("mortality")) {
    defs.push(
      { key: "deaths", header: "Deaths", type: "int", width: 9, total: true, value: (i) => fl[i].deaths },
      { key: "deathsPct", header: "Deaths, % of birds on the first day", type: "percent", width: 12, value: (i) => (fl[i].deathsPct != null ? fl[i].deathsPct! / 100 : null) },
      { key: "birdsEnd", header: "Birds on its last day", type: "int", width: 11, value: (i) => fl[i].birdsAtEnd },
    );
  }
  defs.push({
    key: "note",
    header: "Why blank / note",
    type: "text",
    width: 60,
    value: (i) => {
      const f = fl[i];
      const out = [x.has("production") ? f.statusNote : ""];
      if (x.has("feed")) {
        if (f.eggsPerKgFeed == null && f.eggsPerKgWhy) out.push(`Feed: ${f.eggsPerKgWhy}.`);
        else if (f.fcrWhy) out.push(`FCR: ${f.fcrWhy}.`);
      }
      return out.filter(Boolean).join(" ") || null;
    },
  });
  const notes = [`${x.c.range.label}: each flock over its own days with data in these dates (${x.who}).`];
  if (x.has("production")) notes.push("HD % is a formula (eggs ÷ bird-days); the totals row pools it. Hen-housed % = eggs ÷ the hens housed each day (moved birds counted, deaths not).");
  if (x.has("feed")) notes.push(FEED_NOTE, FCR_NOTE);
  return table("Flocks", `Each flock — ${x.c.range.label} — ${x.who}`, defs, fl.length, notes);
}

// ---- Days -------------------------------------------------------------------------------------------------------
function daysSheet(x: Ctxs, s: PeriodSummary): Dataset {
  const sales = x.farm && x.has("sales") ? x.extras.sales.filter((z) => z.date >= x.c.range.from && z.date <= x.c.range.to) : [];
  // a sale on a day with no register rows still gets its own line, so the sales column adds up to the Summary
  const dates = [...new Set([...s.series.map((p) => p.date), ...sales.map((z) => z.date)])].sort();
  const point = new Map(s.series.map((p) => [p.date, p]));
  const day = dates.map((d) => {
    const rows = rowsOn(x.ctx, d, x.seg, x.only);
    const fed = rows.filter((r) => r.feed != null);
    return { d, p: point.get(d) ?? null, rows, fed, fcr: fcrOf(x.ctx, rows) };
  });
  const econ = x.farm && x.has("costs") ? new Map(dates.filter((d) => point.has(d)).map((d) => [d, dayEconomics(x.cost, d)])) : new Map<string, ReturnType<typeof dayEconomics>>();
  const sum = (xs: ProdRow[], k: "eggs" | "pop" | "feed" | "mort") => xs.reduce((t, r) => t + (r[k] ?? 0), 0);
  const has = (i: number) => day[i].p != null;
  const hasFeed = (i: number) => day[i].fed.length > 0;
  const defs: Def[] = [{ key: "date", header: "Date", type: "date", width: 13, value: (i) => day[i].d }];
  if (x.has("production")) {
    defs.push(
      { key: "eggs", header: "Eggs", type: "int", width: 11, total: true, value: (i) => (has(i) ? day[i].p!.eggs : null) },
      { key: "trays", header: "Trays (30 eggs)", type: "num", width: 10, value: (i) => (has(i) ? day[i].p!.eggs / 30 : null), formula: (r, L) => `IF(ISNUMBER(${L.eggs}${r}),${L.eggs}${r}/30,"")`, totalFormula: (f, l, L) => `SUM(${L.eggs}${f}:${L.eggs}${l})/30` },
      { key: "birddays", header: "Bird-days (birds counted)", type: "int", width: 12, total: true, value: (i) => (has(i) ? day[i].p!.birds : null) },
      { key: "hd", header: "HD % (eggs ÷ bird-days)", type: "percent", width: 11, value: (i) => (has(i) && day[i].p!.hd != null ? day[i].p!.hd! / 100 : null), formula: rowRatio("eggs", "birddays"), totalFormula: poolF("eggs", "birddays") },
    );
  }
  if (x.has("feed")) {
    defs.push(
      { key: "feed", header: "Feed (bags)", type: "int", width: 10, total: true, value: (i) => (hasFeed(i) ? sum(day[i].fed, "feed") : null) },
      { key: "feedKg", header: `Feed kg (bags × ${BAG_KG})`, type: "num", width: 11, value: (i) => (hasFeed(i) ? sum(day[i].fed, "feed") * BAG_KG : null), formula: (r, L) => `IF(ISNUMBER(${L.feed}${r}),${L.feed}${r}*${BAG_KG},"")`, totalFormula: sumF("feedKg") },
      { key: "feedBirds", header: "Bird-days with feed", type: "int", width: 12, total: true, value: (i) => (hasFeed(i) ? sum(day[i].fed, "pop") : null) },
      { key: "gBird", header: "Feed g per bird", type: "num", width: 10, value: (i) => (hasFeed(i) && sum(day[i].fed, "pop") > 0 ? (sum(day[i].fed, "feed") * BAG_KG * 1000) / sum(day[i].fed, "pop") : null), formula: rowRatio("feedKg", "feedBirds", 1000), totalFormula: poolF("feedKg", "feedBirds", 1000) },
      { key: "eggsFed", header: "Eggs of the flocks with feed", type: "int", width: 12, total: true, value: (i) => (hasFeed(i) ? sum(day[i].fed, "eggs") : null) },
      { key: "eggsPerKg", header: "Eggs per kg of feed", type: "num", width: 10, value: (i) => day[i].fcr.eggsPerKg, formula: rowRatio("eggsFed", "feedKg"), totalFormula: poolF("eggsFed", "feedKg") },
      { key: "gEgg", header: "Feed g per egg (exact)", type: "num", width: 10, value: (i) => day[i].fcr.feedPerEggG, formula: rowRatio("feedKg", "eggsFed", 1000), totalFormula: poolF("feedKg", "eggsFed", 1000) },
      { key: "fcrKg", header: "Feed kg in the FCR (flock-days with an egg weight)", type: "num", width: 13, total: true, value: (i) => (day[i].fcr.eggKg > 0 ? day[i].fcr.fcrFeedKg : null) },
      { key: "eggKg", header: "Egg kg (eggs × standard egg weight)", type: "num", width: 13, total: true, value: (i) => (day[i].fcr.eggKg > 0 ? day[i].fcr.eggKg : null) },
      { key: "fcr", header: "FCR (estimated from standard egg weight)", type: "num", width: 12, value: (i) => day[i].fcr.fcr, formula: rowRatio("fcrKg", "eggKg"), totalFormula: poolF("fcrKg", "eggKg") },
      { key: "fcrStd", header: "Breeder's FCR, same flocks", type: "num", width: 11, value: (i) => day[i].fcr.standardFcr },
    );
  }
  if (x.has("mortality")) {
    defs.push(
      { key: "deaths", header: "Deaths", type: "int", width: 9, total: true, value: (i) => (has(i) ? day[i].p!.deaths : null) },
      { key: "birds", header: "Birds at the end of the day", type: "int", width: 12, value: (i) => (has(i) ? day[i].p!.birds : null) },
      { key: "per1000", header: "Deaths per 1,000 birds", type: "num", width: 10, value: (i) => (has(i) && day[i].p!.birds > 0 ? (day[i].p!.deaths / day[i].p!.birds) * 1000 : null), formula: rowRatio("deaths", "birds", 1000) },
    );
  }
  if (x.farm && x.has("sales")) {
    const on = (d: string) => sales.filter((z) => z.date === d);
    defs.push(
      { key: "eggsSold", header: "Eggs sold", type: "int", width: 11, total: true, value: (i) => on(day[i].d).reduce((t, z) => t + z.eggs, 0) },
      { key: "revenue", header: "Egg revenue ₹ (priced sales)", type: "num", width: 14, total: true, value: (i) => on(day[i].d).reduce((t, z) => t + (z.amount ?? 0), 0) },
    );
  }
  if (x.farm && x.has("costs")) {
    const cost = (i: number) => econ.get(day[i].d)?.cost.total ?? null;
    defs.push({ key: "cost", header: "Cost ₹ so far (estimate)", type: "num", width: 14, total: true, value: cost });
    if (x.has("sales")) {
      defs.push({ key: "profit", header: "Profit ₹ (estimate)", type: "num", width: 14, value: (i) => { const c = cost(i); const r = (defs.find((d) => d.key === "revenue")!.value(i) as number) ?? 0; return c != null && r > 0 ? r - c : null; }, formula: (r, L) => `IF(AND(ISNUMBER(${L.cost}${r}),${L.revenue}${r}>0),${L.revenue}${r}-${L.cost}${r},"")`, totalFormula: (f, l, L) => `IF(SUM(${L.revenue}${f}:${L.revenue}${l})>0,SUM(${L.revenue}${f}:${L.revenue}${l})-SUM(${L.cost}${f}:${L.cost}${l}),"")` });
    }
  }
  defs.push({
    key: "note",
    header: "Why blank / note",
    type: "text",
    width: 50,
    value: (i) => {
      const out: string[] = [];
      if (!has(i)) out.push("no register rows this day (a sale only)");
      if (has(i) && x.has("feed") && !hasFeed(i)) out.push("feed not recorded");
      else if (has(i) && x.has("feed") && day[i].fcr.fcr == null && day[i].fcr.why) out.push(`FCR: ${day[i].fcr.why}`);
      else if (has(i) && x.has("feed") && day[i].fcr.leftOut) out.push(`FCR: ${day[i].fcr.leftOut}`);
      const m = econ.get(day[i].d)?.missing ?? [];
      if (m.length) out.push(`cost missing: ${m.join(", ")}`);
      return out.join("; ") || null;
    },
  });
  const notes = [`${x.c.range.label}: one row per day with data (${s.dataNote}). ${x.who}.`, "The totals row adds up the days; ratios in it are pooled (totals ÷ totals), never an average of the days."];
  if (x.has("production")) notes.push(HD_NOTE);
  if (x.has("feed")) notes.push(FEED_NOTE, FCR_NOTE);
  if (x.farm && (x.has("sales") || x.has("costs"))) notes.push(MONEY_NOTE);
  return table("Days", `Day by day — ${x.c.range.label} — ${x.who}`, defs, day.length, notes);
}

// ---- Sales, Costs, Alerts -----------------------------------------------------------------------------------------
function salesSheet(x: Ctxs): Dataset {
  const list = x.extras.sales.filter((z) => z.date >= x.c.range.from && z.date <= x.c.range.to).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const empty = list.length === 0;
  const defs: Def[] = [
    { key: "date", header: "Date", type: "date", width: 13, value: (i) => (empty ? null : list[i].date) },
    { key: "buyer", header: "Buyer", type: "text", width: 22, value: (i) => (empty ? "No egg sales recorded in these dates" : (list[i].buyer ?? "").trim() || "(not recorded)") },
    { key: "channel", header: "Channel", type: "text", width: 11, value: (i) => (empty ? null : list[i].channel) },
    { key: "grade", header: "Grade", type: "text", width: 8, value: (i) => (empty ? null : list[i].grade) },
    { key: "eggs", header: "Eggs", type: "int", width: 10, total: !empty, value: (i) => (empty ? null : list[i].eggs) },
    { key: "amount", header: "Amount ₹", type: "num", width: 12, total: !empty, value: (i) => (empty ? null : list[i].amount) },
    { key: "price", header: "₹ per egg", type: "num", width: 9, value: (i) => (empty || list[i].amount == null || list[i].eggs <= 0 ? null : list[i].amount! / list[i].eggs), formula: (r, L) => (empty ? null : rowRatio("amount", "eggs")(r, L)), totalFormula: empty ? undefined : poolF("amount", "eggs") },
    { key: "note", header: "Why blank / note", type: "text", width: 30, value: (i) => (!empty && list[i].amount == null ? "no rate entered: left out of the revenue" : null) },
  ];
  return table("Sales", `Egg sales — ${x.c.range.label} — whole farm`, defs, empty ? 1 : list.length, ["One row per sale. The amount is empty when no rate was entered (not zero); the totals row's ₹ per egg pools only what is there.", MONEY_NOTE]);
}

function costsSheet(x: Ctxs, s: PeriodSummary): Dataset {
  const dates = s.series.map((p) => p.date);
  const e = dates.map((d) => dayEconomics(x.cost, d));
  const parts: [keyof PeriodSummary["money"]["cost"], string][] = [["feed", "Feed ₹"], ["electricity", "Electricity ₹ (spread)"], ["labour", "Labour ₹ (spread)"], ["packing", "Packing ₹"], ["diesel", "Diesel ₹ (day bought)"], ["medicine", "Medicines ₹ (day bought)"], ["other", "Other ₹"], ["chicks", "Chicks ₹"]];
  const defs: Def[] = [
    { key: "date", header: "Date", type: "date", width: 13, value: (i) => dates[i] },
    ...parts.map(([k, l]): Def => ({ key: k, header: l, type: "num", width: 12, total: true, value: (i) => e[i].cost[k] })),
    { key: "total", header: "Total ₹ (estimate)", type: "num", width: 14, value: (i) => e[i].cost.total, formula: (r, L) => `SUM(${L.feed}${r}:${L.chicks}${r})`, totalFormula: sumF("total") },
    { key: "note", header: "Missing (not zero)", type: "text", width: 50, value: (i) => (e[i].missing.length ? e[i].missing.join(", ") : null) },
  ];
  return table("Costs", `Costs by day (estimate) — ${x.c.range.label} — whole farm`, defs, dates.length, [MONEY_NOTE, "Profit is an estimate: it is egg revenue minus this cost (see the Summary sheet)."]);
}

function alertsSheet(x: Ctxs, s: PeriodSummary): Dataset {
  const list = s.series.flatMap((p) => alertsOn(x, p.date));
  const empty = list.length === 0;
  const defs: Def[] = [
    { key: "date", header: "Date", type: "date", width: 13, value: (i) => (empty ? null : list[i].date) },
    { key: "group", header: "Group", type: "text", width: 10, value: (i) => (empty ? null : list[i].segment ?? "") },
    { key: "flock", header: "Flock", type: "text", width: 12, value: (i) => (empty ? null : list[i].flockLabel ?? "whole farm") },
    { key: "what", header: "What", type: "text", width: 42, value: (i) => (empty ? `No alerts were raised in these dates (${x.who})` : `${list[i].flockLabel ? `${list[i].flockLabel} ` : ""}${KIND_TITLE[list[i].kind]}`.replace(/^./, (c) => c.toUpperCase())) },
    { key: "reason", header: "The numbers", type: "text", width: 80, value: (i) => (empty ? null : list[i].reason) },
  ];
  return table("Alerts", `Alerts — ${x.c.range.label} — ${x.who}`, defs, empty ? 1 : list.length, ["The same alerts the Analytics board lists (reviewed ones and moulting days are left out)."]);
}

function alertsOn(x: Ctxs, d: string) {
  return alertsFor(x.ctx, d, { segment: x.seg }).filter((a) => !x.only || (a.flockId != null && x.only.has(a.flockId)));
}

// ---- Compare ----------------------------------------------------------------------------------------------------
const GROUP_BLOCK: Record<string, Block | "always" | "money"> = { Dates: "always", Age: "always", Eggs: "production", "Hen-housed": "production", "Egg ledger": "production", Birds: "mortality", Feed: "feed", "Money (estimate)": "money" };
function compareBlock(r: CompareRow): Block | "always" {
  const g = GROUP_BLOCK[r.group] ?? "always";
  if (g === "money") return r.key === "rpe" ? "sales" : "costs";
  return g;
}

// ---- the whole file -----------------------------------------------------------------------------------------------
export interface ShareFile {
  sheets: Dataset[];
  meta: string[]; // the lines at the top of every sheet
  stem: string;
  noData: boolean;
}

export function buildShare(ctx: Ctx, cost: CostInput, extras: PeriodExtras, c: ShareChoice, now: Date): ShareFile {
  const has = (b: Block) => c.inc.includes(b);
  const chosen = c.flockIds.length > 0;
  const farm = !chosen;
  const who = chosen ? `Flock${c.flockLabels.length > 1 ? "s" : ""} ${c.flockLabels.join(", ")}` : "All flocks";
  const x: Ctxs = { ctx, cost, extras, c, has, farm, seg: "all", only: chosen ? new Set(c.flockIds) : undefined, who };
  const stem = shareFileStem(c.view, c.range.from, c.range.to);
  const included = BLOCKS.filter(has).filter((b) => c.view !== "compare" || !["alerts", "flocks", "days"].includes(b)).filter((b) => farm || c.view === "compare" || (b !== "sales" && b !== "costs"));
  const meta = ["Yash Poultry Farm", `View: ${VIEW_LABEL[c.view]}`];
  const moneyIn = (farm || c.view === "compare") && (has("sales") || has("costs"));

  if (c.view === "compare" && c.compare) {
    const st = c.compare;
    const A = compareSide(ctx, cost, extras, st.a);
    const B = compareSide(ctx, cost, extras, st.b);
    const rows = compareRows(A, B).filter((r) => { const b = compareBlock(r); return b === "always" || has(b); });
    meta.push(`Dates: A ${st.a.range.label}; B ${st.b.range.label}`, `Flocks: A ${st.a.flockLabel}; B ${st.b.flockLabel}`, `Included: ${included.map((b) => BLOCK_LABEL[b]).join("; ")}`, generatedIST(now));
    if (has("costs")) meta.push("Profit is an estimate.");
    const ds = compareSheet(A, B, st, rows, { money: moneyIn });
    return { sheets: [ds], meta, stem, noData: A.s.daysWithData === 0 && B.s.daysWithData === 0 };
  }

  const s = summarizeRange(ctx, cost, extras, c.range, chosen ? { flocks: c.flockIds } : {});
  meta.push(`Dates: ${c.range.label} (${c.range.days} day${c.range.days === 1 ? "" : "s"}; ${s.dataNote})`, `Flocks: ${chosen ? c.flockLabels.join(", ") : "All flocks"}`, `Included: ${included.map((b) => BLOCK_LABEL[b]).join("; ")}`, generatedIST(now));
  if (farm && has("costs")) meta.push("Profit is an estimate.");
  if (!farm && (has("sales") || has("costs"))) meta.push("Sales and costs are kept for the whole farm, not per flock, so they are not in a file for chosen flocks.");
  for (const n of c.notes) meta.push(n);

  if (s.daysWithData === 0) {
    const first = ctx.dates[0];
    const last = ctx.dates[ctx.dates.length - 1];
    const ds = table("Summary", `No data — ${c.range.label} — ${who}`, [
      { key: "what", header: "What", type: "text", width: 30, value: () => "No data in these dates" },
      { key: "note", header: "Note", type: "text", width: 90, value: () => `The register has no rows for ${chosen ? c.flockLabels.join(", ") : "the farm"} from ${dmy(c.range.from)} to ${dmy(c.range.to)}.${first ? ` Data runs from ${dmy(first)} to ${dmy(last)}.` : ""} Nothing is filled in as zero.` },
    ], 1, []);
    return { sheets: [ds], meta, stem, noData: true };
  }

  const sheets: Dataset[] = [];
  const measures = has("production") || has("feed") || has("mortality") || has("alerts") || (farm && (has("sales") || has("costs")));
  if (measures) {
    const cols = farm
      ? [
          { key: "main", header: SEGMENT_NAME.main, short: "Main", s: summarizeRange(ctx, cost, extras, c.range, { segment: "main" }) },
          { key: "young", header: SEGMENT_NAME.young, short: "Young", s: summarizeRange(ctx, cost, extras, c.range, { segment: "young" }) },
          { key: "whole", header: "Whole farm", short: "Whole farm", s },
        ]
      : [{ key: "chosen", header: who, short: who, s }];
    sheets.push(summarySheet(x, cols));
  }
  if (has("flocks")) sheets.push(flocksSheet(x, s));
  if (has("days")) sheets.push(daysSheet(x, s));
  if (farm && has("sales")) sheets.push(salesSheet(x));
  if (farm && has("costs")) sheets.push(costsSheet(x, s));
  if (has("alerts")) sheets.push(alertsSheet(x, s));
  return { sheets, meta, stem, noData: false };
}
