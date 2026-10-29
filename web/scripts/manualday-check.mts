// Tests the "Enter a day by hand" arithmetic and checks (V12 N4).  npx tsx scripts/manualday-check.mts
import { checkDay, derive, parseDay, autoBirds, reasonsFor, problems, signedEggs, answerCategory, type ManualDay } from "../lib/day/manualDay.ts";

let failed = 0;
const ok = (n: string, c: boolean, x = "") => { if (!c) failed++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : "  " + x}`); };
const TODAY = "2026-10-29";

// the real 28 Oct 2026 page (values from the live register): right page = 8 flocks with feed, left page = 3 flocks
const f = (flockId: string, label: string, group: "main" | "young", prevBirds: number, mortality: number, feed: number | null, eggs: number, birds: number) => ({ flockId, label, group, prevBirds, mortality, feed, eggs, birds });
const day = (): ManualDay => ({
  date: "2026-10-28",
  flocks: [
    f("1", "BAB-1", "main", 6461, 4, 15, 5100, 6457), f("2", "BAB-2", "main", 9598, 14, 14, 6420, 9584), f("3", "BAB-3", "main", 11348, 1, 25, 9840, 11347), f("4", "BAB-4", "main", 9668, 4, 22, 7560, 9664),
    f("5", "BAB-5", "main", 11209, 7, 17, 8460, 11202), f("6", "BAB-6", "main", 6520, 2, 15, 5820, 6518), f("7", "BAB-7", "main", 1698, 0, 4, 1470, 1698), f("8", "BAB-8", "main", 10133, 4, 25, 8460, 10129),
    f("9", "BAB-9", "young", 8892, 3, null, 6720, 8889), f("10", "BAB-10", "young", 9863, 2, null, 5400, 9861), f("11", "BAB-11", "young", 8947, 2, null, 5040, 8945),
  ],
  pages: { rightDeaths: 36, rightFeed: 137, rightEggs: 53130, leftDeaths: 7, leftEggs: 17160 },
  feed: { prevClosing: 203, opening: 203, produced: 132, mill: 163, shed: 35 },
  big: { prevClosing: 313260, opening: 313260, closing: 184500, lines: [{ answer: "other_in", eggs: 1020, label: "bin (+)" }, { answer: "sale", eggs: 181440, label: "Sale (-)" }, { answer: "breakage", eggs: 1470, label: "barke (-)" }] },
  small: { prevClosing: 48450, opening: 48450, closing: 1050, lines: [{ answer: "other_out", eggs: 1020, label: "Small (-)" }, { answer: "sale", eggs: 63420, label: "Sale (-) to Yash P.F." }, { answer: "breakage", eggs: 120, label: "Bay (-)" }] },
  chick: [{ label: "Chicks I", deaths: 7 }, { label: "Chicks II", deaths: 30 }],
});

const x = derive(day());
ok("derived: right page eggs 53,130, feed 137, deaths 36; left eggs 17,160, deaths 7", x.rightEggs === 53130 && x.rightFeed === 137 && x.rightDeaths === 36 && x.leftEggs === 17160 && x.leftDeaths === 7, JSON.stringify(x));
ok("derived: feed box 203 + 132 = 335, fed 137, 198 left = mill 163 + shed 35", x.feedTotal === 335 && x.feedConsumed === 137 && x.feedClosing === 198 && x.feedShedMill === 198);
ok("derived: big ledger 313,260 + 53,130 = 366,390; lines −181,440 −1,470 +1,020 give closing 184,500", x.big.totalLine === 366390 && x.big.linesSum === -181890 && x.big.closing === 184500, JSON.stringify(x.big));
ok("derived: small ledger 48,450 + 17,160 = 65,610; lines −64,560 give 1,050", x.small.totalLine === 65610 && x.small.linesSum === -64560 && x.small.closing === 1050);
const all = checkDay(day(), TODAY);
ok("the real 28 Oct page: every check passes", problems(all).length === 0, JSON.stringify(problems(all).map((c) => c.text)));
ok("there are checks for flocks, pages, feed box and both ledgers", all.length > 30 && all.some((c) => c.id === "fb-close") && all.some((c) => c.id === "big-close") && all.some((c) => c.id === "pg-re"), String(all.length));

const bad = (mut: (d: ManualDay) => void) => { const d = day(); mut(d); return checkDay(d, TODAY); };
ok("a mistyped egg figure breaks the page total, the multiple of 30 and the big ledger's closing", (() => { const c = bad((d) => (d.flocks[1].eggs = 6425)); const p = problems(c).map((q) => q.id); return p.includes("pg-re") && p.includes("e30-2") && p.includes("big-close"); })());
ok("deaths 14 typed as 1: page total 36 no longer ties and the bird chain breaks for that flock", (() => { const c = bad((d) => (d.flocks[1].mortality = 1)); const p = problems(c).map((q) => q.id); return p.includes("pg-rd") && p.includes("chain-2"); })());
ok("birds left that do not follow yesterday's chain say the difference", (() => { const c = bad((d) => (d.flocks[0].birds = 6450)).find((q) => q.id === "chain-1")!; return c.level === "warn" && /difference −7/.test(c.text) && /Flocks screen/.test(c.text); })());
ok("a feed figure typed wrong breaks the feed box and the feed page total", (() => { const p = problems(bad((d) => (d.flocks[2].feed = 52))).map((q) => q.id); return p.includes("pg-rf") && p.includes("fb-close"); })());
ok("mill + shed that do not equal the bags left are flagged", (() => { const c = bad((d) => (d.feed.shed = 30)).find((q) => q.id === "fb-close")!; return c.level === "warn" && /difference −5/.test(c.text); })());
ok("a ledger closing that does not tie is flagged with the difference", (() => { const c = bad((d) => (d.big.closing = 184530)).find((q) => q.id === "big-close")!; return c.level === "warn" && /difference \+30/.test(c.text); })());
ok("a ledger that does not open at yesterday's closing is flagged", (() => { const c = bad((d) => (d.small.opening = 48480)).find((q) => q.id === "small-open")!; return c.level === "warn"; })());
ok("a sale line that is not a multiple of 30 is flagged (breakage may be any number)", (() => { const p = problems(bad((d) => d.big.lines.push({ answer: "sale", eggs: 100, label: "x" }))).map((q) => q.id); return p.some((i) => i.startsWith("big-l30")) && !problems(bad((d) => d.big.lines.push({ answer: "breakage", eggs: 100, label: "x" }))).some((q) => q.id.startsWith("big-l30")); })());
ok("a day in the future is an error", problems(checkDay({ ...day(), date: "2026-11-05" }, TODAY)).some((c) => c.id === "date" && c.level === "error"));
ok("a flock card with only some fields says what is missing", (() => { const d = day(); d.flocks[3].feed = null; d.flocks[3].eggs = null; const p = problems(checkDay(d, TODAY)).map((q) => q.id); return p.includes("feed-4") && p.includes("eggs-4"); })());
ok("reasonsFor gives one flock's own reasons for its flag", reasonsFor(bad((d) => (d.flocks[1].eggs = 6425)), "2").length === 1 && reasonsFor(bad((d) => (d.flocks[1].eggs = 6425)), "1").length === 0);
ok("birds carry from yesterday: 9,598 − 14 = 9,584; no row yesterday gives nothing", autoBirds(9598, 14) === 9584 && autoBirds(null, 3) === null);
ok("one-tap answers: signs and categories (sale takes eggs out, late eggs add, anil goes both ways)", signedEggs({ answer: "sale", eggs: 30, label: "" }) === -30 && signedEggs({ answer: "late", eggs: 30, label: "" }) === 30 && signedEggs({ answer: "anil_in", eggs: 30, label: "" }) === 30 && answerCategory("anil_out") === "cross_farm_adjustment" && answerCategory("late") === "production_addition" && answerCategory("local_sale") === "local_sale" && answerCategory("zzz") === null);
ok("parseDay: the form's JSON comes back as a typed day; junk lines and bad JSON are dropped", (() => { const d = parseDay(JSON.stringify({ ...day(), big: { ...day().big, lines: [...day().big.lines, { answer: "zzz", eggs: 5 }, { answer: "sale", eggs: 0 }] } })); return d != null && d.big.lines.length === 3 && parseDay("{not json") === null && parseDay("{}") === null; })());
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
