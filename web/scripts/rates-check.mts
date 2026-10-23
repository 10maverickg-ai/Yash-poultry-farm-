// Tests the BAFTA rate message parser on the sample SMS and layout variants.
//   node scripts/rates-check.mts
import { parseRateMessages, rateNumbers, findDate } from "../lib/rates/parse.ts";

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
};

const one = (t: string) => parseRateMessages(t).map((r) => [r.date, r.per100, r.subsidyPaise]);
eq("owner sample", one("OCTOBER 19, 2026 BFTA EGG RATE RS.560/- Subsidy for 0 Paise"), [["2026-10-19", 560, 0]]);
eq("with sender prefix", one("HPFABW-S: OCTOBER 18, 2026 BFTA EGG RATE RS.550/- Subsidy for 0 Paise"), [["2026-10-18", 550, 0]]);
eq("lowercase / spaces", one("october 17, 2026  bfta egg rate  Rs. 542/-  subsidy for 0 paise"), [["2026-10-17", 542, 0]]);
eq("day-month order", one("17 Oct 2026 BAFTA rate Rs 542 subsidy 0 paise"), [["2026-10-17", 542, 0]]);
eq("numeric date", one("17/10/2026 BAFTA egg rate Rs.542/-"), [["2026-10-17", 542, 0]]);
eq("subsidy non-zero", one("OCTOBER 20, 2026 BFTA EGG RATE RS.560/- Subsidy for 10 Paise"), [["2026-10-20", 560, 10]]);
eq("no date in message", one("BFTA EGG RATE RS.560/- Subsidy for 0 Paise"), [[null, 560, 0]]);
eq("three messages pasted together (September backfill)", one(
  "SEPTEMBER 1, 2026 BFTA EGG RATE RS.500/- Subsidy for 0 Paise\nSEPTEMBER 2, 2026 BFTA EGG RATE RS.505/- Subsidy for 0 Paise\nSEPTEMBER 3, 2026 BFTA EGG RATE RS.510/- Subsidy for 0 Paise"),
  [["2026-09-01", 500, 0], ["2026-09-02", 505, 0], ["2026-09-03", 510, 0]]);
eq("message wrapped over two lines", one("OCTOBER 19, 2026\nBFTA EGG RATE RS.560/-\nSubsidy for 0 Paise"), [["2026-10-19", 560, 0]]);
eq("junk gives nothing", one("hello there"), []);
eq("invalid date rejected", findDate("FEBRUARY 31, 2026"), null);
const n = rateNumbers(560, 0);
eq("560 per 100 → 5.60 / big 5.57 / small 5.35", [n.perEgg, n.effective, n.big, n.small], [5.6, 5.6, 5.57, 5.35]);
eq("subsidy 10 paise → effective 5.50", rateNumbers(560, 10).effective, 5.5);
// Same arithmetic as the 17 existing August rows: big = rate - 0.03, small = rate - 0.25.
eq("Aug 1 pattern (4.85 → 4.82 / 4.60)", [rateNumbers(485, 0).big, rateNumbers(485, 0).small], [4.82, 4.6]);
process.exit(failed ? 1 : 0);
