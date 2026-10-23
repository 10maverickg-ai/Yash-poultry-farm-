// Writes the owner's alert review table (docs/ALERTS_SEPTEMBER.md): every alert the
// rules raise over a date range, with the number that triggered it, any KNOWN
// explanation found in the data, and a guess ("real" / "probably noise") with the
// reason. It does not change a threshold. Guesses are only meant to help the owner
// mark each row; the owner's verdicts (alert_feedback) decide what is tuned.
//
//   node scripts/alerts-report.mts <fixture-dir> <from> <to> <out.md>
import { writeFileSync } from "node:fs";
import { loadInput } from "./fixtureInput.mts";
import { buildCtx, alertsFor, addDays, diffDays, moultOn, feedDaysLeft, eggStockDays, RULES, type Alert, type Ctx } from "../lib/analytics/engine.ts";

const [dir, from, to, out] = process.argv.slice(2);
if (!out) throw new Error("usage: alerts-report.mts <fixture-dir> <from> <to> <out.md>");
const input = loadInput(dir);
const ctx: Ctx = buildCtx(input);
const rowOn = (flockId: string, d: string) => ctx.byFlock.get(flockId)?.find((r) => r.date === d);
const movesNear = (flockId: string, d: string) => input.movements.filter((m) => m.flockId === flockId && Math.abs(diffDays(m.date, d)) <= 1);
const n1 = (x: number) => (Math.round(x * 10) / 10).toString();
const date = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const TYPE: Record<string, string> = { transfer_out: "moved out", transfer_in: "moved in", sale: "sold", unexplained_out: "left", unexplained_in: "arrived", count_adjustment: "count adjusted", cull: "culled" };

function hdAvgBefore(flockId: string, d: string): number | null {
  const rs = (ctx.byFlock.get(flockId) ?? []).filter((r) => r.date < d && diffDays(d, r.date) <= 14).slice(-7);
  const v = rs.map((r) => r.hd).filter((x): x is number => x != null);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

function judge(a: Alert): { known: string; guess: string } {
  const f = a.flockId;
  if (a.kind === "production_drop" && f) {
    const mv = movesNear(f, a.date);
    const avg = hdAvgBefore(f, a.date)!;
    const next = [1, 2, 3].map((k) => rowOn(f, addDays(a.date, k))?.hd).filter((x): x is number => x != null);
    const known: string[] = [];
    if (moultOn(ctx, f, a.date)) known.push("flock is moulting");
    if (mv.length) known.push("bird movement: " + mv.map((m) => `${m.change > 0 ? "+" : "−"}${Math.abs(m.change).toLocaleString("en-IN")} ${TYPE[m.type] ?? m.type} ${date(m.date)}`).join(", "));
    const below = next.filter((h) => h < avg - RULES.dropPointsTwoDay).length;
    let guess: string;
    if (next.length === 0) guess = "unclear: the data ends before the next day, so I cannot say whether it recovered";
    else if (mv.length) guess = "probably noise: the bird count moved around this day, so the HD% is measured on a different number of birds";
    else if (next.length && next[0] >= avg - 1.5) guess = `probably noise: one-day dip, HD was back to ${n1(next[0])}% the next day`;
    else if (next.length >= 2 && below >= 2) guess = `real: still ${RULES.dropPointsTwoDay}+ points under its own average on the next ${below} days (${next.map(n1).join("%, ")}%)`;
    else guess = "unclear: partly recovered the next day";
    return { known: known.join("; ") || "none found", guess };
  }
  if (a.kind === "low_feed_stock") {
    const next = ctx.input.feedBoxes.filter((b) => b.date === addDays(a.date, 1));
    const cons = next.reduce((s, b) => s + (b.consumed ?? 0), 0);
    const fd = feedDaysLeft(ctx, a.date);
    const normal = fd && cons >= 0.9 * fd.perDay;
    return {
      known: "the farm's own mill delivers feed every day (stock about 1 day is normal)",
      guess: normal ? `probably noise: feed was still eaten as normal the next day (${cons} bags vs ${n1(fd!.perDay)}/day average)` : `real: consumption fell the next day (${cons} bags${fd ? ` vs ${n1(fd.perDay)}/day average` : ""}), so feed may really have run short`,
    };
  }
  if (a.kind === "egg_buildup") {
    const es = eggStockDays(ctx, a.date);
    const nextSale = input.farmfreshDates.filter((d) => d > a.date && diffDays(d, a.date) <= 2).sort()[0];
    const after = eggStockDays(ctx, addDays(a.date, 1));
    return {
      known: "Farmfresh collects every 3–4 days" + (nextSale ? `; a Farmfresh sale followed on ${date(nextSale)}` : "; no Farmfresh sale in the next 2 days"),
      guess: nextSale ? `probably noise: collected ${diffDays(nextSale, a.date)} day(s) later (stock ${es ? es.closing.toLocaleString("en-IN") : "?"} → ${after ? after.closing.toLocaleString("en-IN") : "?"})` : "real: no collection followed within 2 days",
    };
  }
  if (a.kind === "high_mortality" && f) {
    const r = rowOn(f, a.date)!;
    const after = [1, 2, 3].map((k) => rowOn(f, addDays(a.date, k))?.mort).filter((x): x is number => x != null);
    const pct = (r.mort ?? 0) / ((r.pop ?? 0) + (r.mort ?? 0)) * 100;
    const calm = after.length > 0 && after.every((m) => m <= (r.mort ?? 0) / 2);
    return {
      known: "none found",
      guess: calm ? `probably noise: a one-day blip (${r.mort} deaths = ${pct.toFixed(2)}% of the flock), the next days had ${after.join(", ")}` : `real: deaths stayed high afterwards (${after.join(", ")})`,
    };
  }
  return { known: "none found", guess: "unclear" };
}

const rows: string[] = [];
const counts: Record<string, number> = {};
const verdictCount = { real: 0, noise: 0, unclear: 0 };
for (let d = from; d <= to; d = addDays(d, 1)) {
  for (const a of alertsFor(ctx, d)) {
    const j = judge(a);
    counts[a.kind] = (counts[a.kind] ?? 0) + 1;
    verdictCount[j.guess.startsWith("real") ? "real" : j.guess.startsWith("probably noise") ? "noise" : "unclear"]++;
    const num = a.reason.replace(/\|/g, "/");
    rows.push(`| ${date(a.date)} | ${a.flockLabel ?? "farm"}${a.registerLabel && a.registerLabel !== a.flockLabel ? ` (register ${a.registerLabel})` : ""} | ${a.kind.replace(/_/g, " ")} | ${num} | ${j.known} | ${j.guess} | |`);
  }
}
const md = `# Alert review — ${from} to ${to}

Every alert the current rules raise on the real data for this period, so you can mark each one **real** or **noise**.
The rules have NOT been changed; the thresholds are the ones you decided (production drop ≥5 points or ≥3 points two days running;
high mortality >2× own average AND >0.1% AND ≥5 deaths; low feed under 0.5 day or received below consumption 3 days running;
egg stock over 5 days of production or 4+ days with no Farmfresh sale). August is cleared and not included.

On the Analytics page each alert has **This was real / This was noise** buttons (saved in \`alert_feedback\`); mark them there or fill the
last column here. Rules will be tuned from your verdicts.

**Count by rule:** ${Object.entries(counts).map(([k, v]) => `${k.replace(/_/g, " ")} ${v}`).join(" · ")} — **${rows.length} alerts**.
**My guess:** ${verdictCount.real} look real, ${verdictCount.noise} look like noise, ${verdictCount.unclear} unclear. These are guesses from the data only.

| Date | Flock (real name) | Rule | Number that triggered it | Known explanation found | My guess and why | Your verdict (real / noise) |
|---|---|---|---|---|---|---|
${rows.join("\n")}
`;
writeFileSync(out, md);
console.log(`wrote ${out}: ${rows.length} alerts`, counts, verdictCount);
