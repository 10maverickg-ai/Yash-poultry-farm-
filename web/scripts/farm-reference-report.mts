// V11 M6 (read-only): what the farm's own records say per season and group — HD ratio and death rate bands against the book
// and the starting death limits — and every flock-week that crosses amber or red under the new death rules.
//   npx tsx scripts/farm-reference-report.mts <fixture-dir>
import { loadInput } from "./fixtureInput.mts";
import { buildCtx, lastDayOfData, segmentOn, addDays, diffDays } from "../lib/analytics/engine.ts";
import { learnRealistic, deathLimits, weeklyDeathRate, bandAgeWeeks, seasonOf, seasonLabel, SEASONS, REALISTIC_CONFIG as C } from "../lib/analytics/realistic.ts";
import type { RealisticBand, Season, RGroup } from "../lib/analytics/realisticTypes.ts";

const input = loadInput(process.argv[2]);
const ctx = buildCtx(input);
const asOf = lastDayOfData(ctx);
const m = learnRealistic(ctx, asOf, []);
const f1 = (x: number | null, d = 1) => (x == null ? "–" : x.toFixed(d));
const bookHd = (age: number) => input.std.find((s) => s.age === age)?.hdp ?? null;
const bookDeath = (age: number) => { const a = input.std.find((s) => s.age === age), b = input.std.find((s) => s.age === age - 1); return a?.cumDepl != null && b?.cumDepl != null ? a.cumDepl - b.cumDepl : null; };

console.log(`# Farm reference report (read-only), data 2026-07-02 to ${asOf}\n`);
console.log("Seasons present in the data: " + [...new Set(ctx.dates.map((d) => seasonOf(d)))].map((s) => `${s} (${ctx.dates.filter((d) => seasonOf(d) === s).length} days)`).join(", ") + ". Seasons with no records (HOT, COLD, SPRING) are not shown and nothing is invented for them.\n");
console.log(`Starting death limits (percent of birds per week): cool/cold/spring amber ${C.deathStart.cool.amber}, red ${C.deathStart.cool.red}; monsoon/hot amber ${C.deathStart.hot.amber}, red ${C.deathStart.hot.red}. Learned limits = usual x ${C.deathAmberMultiple} (amber) and x ${C.deathRedMultiple} (red).\n`);

const present = SEASONS.filter((s) => ctx.dates.some((d) => seasonOf(d) === s));
for (const g of ["main", "young"] as RGroup[]) {
  for (const s of [...present, "all" as const]) {
    const rows = m.bands.filter((b) => b.group === g && b.season === s && b.metric === "hd" && (b.daysSeen > 0 || b.healthyDays > 0));
    if (rows.length === 0) continue;
    console.log(`\n## ${g} group, ${s === "all" ? "all seasons together" : s}\n`);
    console.log("| age band (weeks) | healthy days | flocks | HD: learned % of book | realistic HD (book@mid) | deaths: usual %/wk (healthy days, flocks) | learned amber / red | starting amber / red | book %/wk |");
    console.log("|---|---|---|---|---|---|---|---|---|");
    for (const b of rows) {
      const d = m.bands.find((x) => x.group === g && x.season === s && x.metric === "mortality" && x.band === b.band);
      const mid = b.fromWeek + 2;
      const bk = bookHd(mid);
      const start = C.deathStart[C.deathClass[s === "all" ? "MONSOON" : (s as Season)]];
      const lim = d?.learnedRate != null;
      console.log(`| ${b.fromWeek}–${b.toWeek} | ${b.healthyDays} | ${b.flocks} | ${b.learnedRatio != null ? (b.learnedRatio * 100).toFixed(1) + "%" : "not learned yet"} | ${b.learnedRatio != null && bk != null ? `${f1(bk * b.learnedRatio)} (${f1(bk)})` : "–"} | ${lim ? `${f1(d!.learnedRate, 2)} (${d!.healthyDays}, ${d!.flocks})` : `not learned yet${d ? ` (${d.healthyDays} days, ${d.flocks} flock${d.flocks === 1 ? "" : "s"})` : ""}`} | ${lim ? `${f1(d!.learnedRate! * C.deathAmberMultiple, 2)} / ${f1(d!.learnedRate! * C.deathRedMultiple, 2)}` : "–"} | ${s === "all" ? "(depends on season)" : `${start.amber} / ${start.red}`} | ${f1(bookDeath(mid), 2)} |`);
    }
  }
}

// flock-weeks that cross amber or red
console.log("\n## Weeks that crossed amber or red (calendar weeks Monday to Sunday, at least 5 days of rows)\n");
console.log("Judged two ways: (A) the limits the app will use (our usual from the farm's own data; the starting values where a band is not learned yet) and (B) the starting values alone.\n");
console.log("| flock | week (Mon–Sun) | season | deaths | avg birds | deaths % that week | A: our usual / amber / red | A verdict | B: starting amber / red | B verdict |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
const monday = (d: string) => addDays(d, -((new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7));
let n = 0;
const counts = { A: { amber: 0, red: 0 }, B: { amber: 0, red: 0 } };
for (const [fid, rows] of [...ctx.byFlock].sort((a, b) => (ctx.flockById.get(a[0])?.label ?? "").localeCompare(ctx.flockById.get(b[0])?.label ?? "", undefined, { numeric: true }))) {
  const flock = ctx.flockById.get(fid)!;
  const weeks = new Map<string, typeof rows>();
  for (const r of rows) (weeks.get(monday(r.date)) ?? weeks.set(monday(r.date), []).get(monday(r.date))!).push(r);
  for (const [mon, rs] of [...weeks].sort()) {
    if (rs.length < 5) continue;
    const rate = weeklyDeathRate(rs, 5, 7);
    if (rate == null) continue;
    const end = rs[rs.length - 1].date;
    const g = segmentOn(ctx, fid, end);
    if (!g) continue;
    const age = bandAgeWeeks(flock, end);
    const lim = deathLimits(m, g, age, end);
    const st = C.deathStart[C.deathClass[seasonOf(end)]];
    const vA = rate > lim.red ? "RED" : rate > lim.amber ? "amber" : "";
    const vB = rate > st.red ? "RED" : rate > st.amber ? "amber" : "";
    if (vA === "RED") counts.A.red++; else if (vA) counts.A.amber++;
    if (vB === "RED") counts.B.red++; else if (vB) counts.B.amber++;
    if (!vA && !vB) continue;
    n++;
    const deaths = rs.reduce((s, r) => s + (r.mort ?? 0), 0);
    const pop = rs.reduce((s, r) => s + (r.pop ?? 0), 0) / rs.length;
    console.log(`| ${flock.label} | ${mon} – ${addDays(mon, 6)} | ${seasonOf(end)} | ${deaths} | ${Math.round(pop)} | ${rate.toFixed(2)} | ${lim.usual != null ? f1(lim.usual, 2) : "starting"} / ${f1(lim.amber, 2)} / ${f1(lim.red, 2)} (${lim.source}${lim.source !== "starting" ? ", " + seasonLabel(lim.seasonUsed) : ""}) | ${vA || "ok"} | ${st.amber} / ${st.red} | ${vB || "ok"} |`);
  }
}
console.log(`\n${n} flock-weeks cross amber or red under at least one rule. Under (A): ${counts.A.red} red, ${counts.A.amber} amber. Under (B): ${counts.B.red} red, ${counts.B.amber} amber.`);
