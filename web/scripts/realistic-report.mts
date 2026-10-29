// K6: read-only print of what the farm's own records teach, per group, metric and 5-week age band.
//   npx tsx scripts/realistic-report.mts <fixture-dir>
import { loadInput } from "./fixtureInput.mts";
import { buildCtx, lastDayOfData } from "../lib/analytics/engine.ts";
import { learnRealistic, REALISTIC_CONFIG } from "../lib/analytics/realistic.ts";

const input = loadInput(process.argv[2]);
const ctx = buildCtx(input);
const asOf = lastDayOfData(ctx);
const m = learnRealistic(ctx, asOf, []);
const hd = new Map(input.std.map((s) => [s.age, s.hdp]));
console.log(`as of ${asOf}; config`, JSON.stringify(REALISTIC_CONFIG));
for (const metric of ["hd", "feed", "mortality"] as const) {
  console.log(`\n== ${metric} ==`);
  console.log("group  band(weeks)  seen  healthy  flocks  samples  from..to              ratio   book@mid  realistic  note");
  for (const b of m.bands.filter((x) => x.metric === metric)) {
    const mid = b.fromWeek + 2;
    const book = metric === "hd" ? hd.get(mid) : metric === "feed" ? input.std.find((s) => s.age === mid)?.feedG : undefined;
    const r = b.learnedRatio;
    console.log(
      [b.group.padEnd(6), `${b.fromWeek}-${b.toWeek}`.padEnd(11), String(b.daysSeen).padStart(4), String(b.healthyDays).padStart(7), String(b.flocks).padStart(6), String(b.samples).padStart(7), `${b.dateFrom ?? "-"}..${b.dateTo ?? "-"}`.padEnd(21), r != null ? (r * 100).toFixed(1) + "%" : "  –  ", book != null ? String(book) : "–", r != null && book != null ? (book * r).toFixed(1) : "not learned", b.notLearnedReason ?? ""].join("  "),
    );
  }
}
