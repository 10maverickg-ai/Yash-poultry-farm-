// V16: feed on the Analytics board, for the board day and for the last 7 days, each labelled.
//   npx tsx scripts/feed-check.mts <fixture-dir>        (run-all dumps fresh fixtures from the database)
// Expected figures come from the raw rows (no engine), plus the owner's own figures of 21 Nov 2026
// (19 Nov: 154 bags, about 105 g/bird; 13-19 Nov: 1,102 bags, 157 a day, 107 g/bird a day; 18 Nov: 163 bags).
/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows are untyped JSON dumps */
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { loadInput } from "./fixtureInput.mts";
import { buildCtx, flockCards, addDays } from "../lib/analytics/engine";
import { segmentPanel } from "../lib/analytics/segments";
import { feedPair, flockFeed, segmentFeed, gPerBird } from "../lib/analytics/feed";
import { makeRange, summarizeRange, type PeriodExtras } from "../lib/analytics/period";
import { BAG_KG, type CostInput } from "../lib/costs/engine";
import { FeedCells } from "../components/SegmentPanels";

const dir = process.argv[2];
const j = (n: string) => JSON.parse(readFileSync(`${dir}/${n}.json`, "utf8"));
const input = loadInput(dir);
const ctx = buildCtx(input);
const dp: any[] = j("dp");
const segOf = new Map<string, string>(j("flocks").map((f: any) => [f.flock_internal_id, f.segment]));
const labelOf = new Map<string, string>(j("flocks").map((f: any) => [f.display_label, f.flock_internal_id]));
const extras: PeriodExtras = { sales: [], deductions: [], birdSales: [] };
const cost: CostInput = { settings: [], purchases: [], diesel: [], prod: [], sales: [], birdSales: [] };

let bad = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (!cond) bad++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`); };
const near = (name: string, got: number | null | undefined, want: number, tol = 1e-9) => ok(name, got != null && Math.abs(got - want) <= tol, `got ${got} want ${want}`);
const last = ctx.dates[ctx.dates.length - 1];
const has = (d: string) => ctx.dates.includes(d);

// raw rows, no engine
const raw = (d: string, seg: string) => dp.filter((r) => r.date === d && segOf.get(r.flock_internal_id) === seg);
const rawBags = (d: string, seg: string) => { const rs = raw(d, seg).filter((r) => r.feed_bags != null); return rs.length ? rs.reduce((s, r) => s + r.feed_bags, 0) : null; };
const rawBirds = (d: string, seg: string) => raw(d, seg).filter((r) => r.feed_bags != null).reduce((s, r) => s + (r.bird_population ?? 0), 0);

ok("the bag weight is the existing constant (45 kg), not a new one", BAG_KG === 45 && Math.abs(gPerBird(154, 65886)! - (154 * 45 * 1000) / 65886) < 1e-9);

// ---- the owner's case: board as of 19 Nov, Main flocks ----
if (has("2026-11-19") && has("2026-11-13")) {
  const p = segmentPanel(ctx, extras, "2026-11-19", "main").feed.pair;
  ok("19 Nov, Main: feed TODAY is the register's 154 bags (not the 7-day average 157)", p.day.recorded && p.day.bags === 154 && p.day.bags === rawBags("2026-11-19", "main"), `${p.day.bags}`);
  near("19 Nov, Main: g/bird today = 154 × 45 kg ÷ that day's birds (about 105)", p.day.gPerBird, (154 * 45000) / rawBirds("2026-11-19", "main"));
  ok("19 Nov, Main: g/bird today rounds to 105", Math.round(p.day.gPerBird!) === 105, String(p.day.gPerBird));
  const days = Array.from({ length: 7 }, (_, i) => addDays("2026-11-13", i));
  const wBags = days.reduce((s, d) => s + (rawBags(d, "main") ?? 0), 0);
  const wBirds = days.reduce((s, d) => s + rawBirds(d, "main"), 0);
  ok("19 Nov, Main: last 7 days are 13-19 Nov, 7 of 7 days with feed", p.week.from === "2026-11-13" && p.week.to === "2026-11-19" && p.week.days === 7 && p.week.daysRecorded === 7);
  ok("19 Nov, Main: last 7 days total 1,102 bags (= the raw rows)", p.week.bags === 1102 && wBags === 1102, `${p.week.bags}`);
  ok("19 Nov, Main: average 157 bags a day (1,102 ÷ 7 = 157.4)", Math.abs(p.week.bagsPerDay! - 1102 / 7) < 1e-9 && Math.round(p.week.bagsPerDay!) === 157);
  near("19 Nov, Main: average g/bird a day = 1,102 × 45 kg ÷ the 7 days' birds (about 107)", p.week.gPerBird, (1102 * 45000) / wBirds);
  ok("19 Nov, Main: average g/bird a day rounds to 107", Math.round(p.week.gPerBird!) === 107, String(p.week.gPerBird));
  // the screen: every feed number carries its period
  const html = renderToStaticMarkup(createElement(FeedCells, { f: p, daysLeft: segmentPanel(ctx, extras, "2026-11-19", "main").feed.daysLeft }));
  const text = html.replace(/<[^>]+>/g, " | ");
  ok("screen: 'Feed today (19 Nov)' shows 154 bags and '105 g/bird today'", /Feed today \(19 Nov\) \| +\| 154 bags \| +\| 105 g\/bird today/.test(text), text.slice(0, 120));
  ok("screen: 'Feed, last 7 days (13 Nov – 19 Nov)' shows 1,102 bags, 'average 157 bags a day · 107 g/bird a day'", /Feed, last 7 days \(13 Nov – 19 Nov\) \| +\| 1,102 bags \| +\| average 157 bags a day · 107 g\/bird a day/.test(text));
  ok("screen: the 7-day average (157) never appears as the day's figure", !/Feed today[^|]*\|[^|]*157/.test(text) && !/bags\/day/.test(text));
  ok("screen: days of stock left keeps its own label", /feed stock left: 0\.3 days/.test(text));
}
if (has("2026-11-18")) {
  const p = segmentPanel(ctx, extras, "2026-11-18", "main").feed.pair;
  ok("18 Nov, Main: feed today is 163 bags", p.day.bags === 163 && rawBags("2026-11-18", "main") === 163, `${p.day.bags}`);
  near("18 Nov, Main: g/bird today from that day's own birds", p.day.gPerBird, (163 * 45000) / rawBirds("2026-11-18", "main"));
}

// ---- young flocks BAB-9, BAB-10, BAB-11: feed 29 Oct - 18 Nov, none on 19 Nov ----
const young = ["BAB-9", "BAB-10", "BAB-11"].map((l) => labelOf.get(l)!).filter(Boolean);
ok("the three young flocks are in the data", young.length === 3);
const span: string[] = [];
for (let d = "2026-10-29"; d <= "2026-11-18" && d <= last; d = addDays(d, 1)) span.push(d);
let shown = 0;
const missing: string[] = [];
for (const d of span) for (const id of young) {
  const r = dp.find((x) => x.date === d && x.flock_internal_id === id);
  const f = flockFeed(ctx, id, d);
  if (r && r.feed_bags != null && f.day.recorded && f.day.bags === r.feed_bags && f.day.gPerBird != null) shown++; else missing.push(`${d} ${id.slice(0, 4)}`);
}
ok(`young flocks show a number on every day 29 Oct - 18 Nov (${span.length} days × 3 flocks)`, missing.length === 0 && shown === span.length * 3, missing.slice(0, 4).join(", "));
const cards18 = flockCards(ctx, "2026-11-18").filter((c) => young.includes(c.flockId));
ok("18 Nov flock cards: BAB-9/10/11 show their own bags and g/bird for the day", cards18.length === 3 && cards18.every((c) => c.feed.day.recorded && c.feed.day.gPerBird != null));
if (has("2026-11-19")) {
  const cards19 = flockCards(ctx, "2026-11-19").filter((c) => young.includes(c.flockId));
  ok("19 Nov flock cards: BAB-9/10/11 'feed not recorded' for the day, still a 7-day figure (6 of 7 days)", cards19.length === 3 && cards19.every((c) => !c.feed.day.recorded && c.feed.day.bags == null && c.feed.week.daysRecorded === 6 && c.feed.week.bagsPerDay != null));
  const yp = segmentFeed(ctx, "2026-11-19", "young");
  ok("19 Nov, Young group: today not recorded; last 7 days recorded on 6 of 7 days, averages over those 6", !yp.day.recorded && yp.week.daysRecorded === 6 && yp.week.days === 7 && Math.abs(yp.week.bagsPerDay! - yp.week.bags! / 6) < 1e-9);
  const html = renderToStaticMarkup(createElement(FeedCells, { f: yp })).replace(/<[^>]+>/g, " | ");
  ok("screen: young 19 Nov says 'feed not recorded' with the reason, never a bare '–'", /Feed today \(19 Nov\) \| +\| feed not recorded \| +\| the register has no feed figure for this group on 19 Nov/.test(html) && !/\| –/.test(html) && /recorded on 6 of these 7 days/.test(html));
  const s = summarizeRange(ctx, cost, extras, makeRange("2026-11-13", "2026-11-19"), { segment: "young" });
  ok("week view, young 13-19 Nov: day table says 'not recorded' on 19 Nov, not 0; totals over 6 days", s.series.find((x) => x.date === "2026-11-19")?.feedRecorded === false && s.feed.daysRecorded === 6 && Math.abs((s.feed.bagsPerDay ?? 0) - s.feed.bags / 6) < 1e-9);
}
const ysegNone = segmentFeed(ctx, "2026-10-15", "young");
ok("a window with no feed at all (young, mid-October): one 'feed not recorded' tile", ysegNone.week.daysRecorded === 0 && /feed not recorded/.test(renderToStaticMarkup(createElement(FeedCells, { f: ysegNone }))));

// ---- the helper itself ----
const fp = feedPair([{ date: "a", bags: 10, birds: 4500 }, { date: "b", bags: null, birds: 4400 }, { date: "c", bags: 20, birds: 4500 }], "b");
ok("pair: a day without a figure is not recorded (not 0); the 7 days use only days with feed", !fp.day.recorded && fp.day.bags == null && fp.week.daysRecorded === 2 && fp.week.bags === 30 && fp.week.bagsPerDay === 15 && Math.abs(fp.week.gPerBird! - (30 * 45000) / 9000) < 1e-9);
ok("pair: g/bird today uses that day's own birds", Math.abs(feedPair([{ date: "x", bags: 154, birds: 65886 }], "x").day.gPerBird! - (154 * 45000) / 65886) < 1e-9);
// the board card for every day: the day tile equals the raw row sum, the week tile its 7 days
let boardBad = 0;
for (const d of ctx.dates.filter((x) => x >= "2026-08-01")) {
  const p = segmentFeed(ctx, d, "main");
  if ((p.day.bags ?? null) !== rawBags(d, "main")) boardBad++;
}
ok("every board day since 1 Aug: Main 'feed today' = that day's register bags", boardBad === 0, `${boardBad} differ`);

process.exit(bad ? 1 : 0);
