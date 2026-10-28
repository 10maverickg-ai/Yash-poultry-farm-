// Tests the BAFTA rate message parser on the sample SMS and layout variants.
//   node scripts/rates-check.mts
import { parseRateMessages, parseNetPriceList, rateNumbers, findDate, classifySale, salePrice } from "../lib/rates/parse.ts";

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
eq("560 per 100 -> rate 5.60, Farmfresh 5.57, local 5.61", [n.perEgg, n.effective, n.farmfresh, n.local], [5.6, 5.6, 5.57, 5.61]);
eq("subsidy 10 paise -> effective 5.50", rateNumbers(560, 10).effective, 5.5);
// Sept 1 stored rate 5.53: owner's Farmfresh price 5.50 = rate - 0.03.
eq("Sept 1 (5.53): Farmfresh 5.50, local 5.54", [salePrice(5.53, "farmfresh"), salePrice(5.53, "local")], [5.5, 5.54]);
eq("Farmfresh big OR small both at rate - 0.03 (no 0.25 discount any more)", [salePrice(5.4, "farmfresh")], [5.37]);
eq("classify: ledger local_sale -> local", classifySale({ category: "local_sale", label: "Ashok", eggs: 600 }), "local");
eq("classify: 'sale' with a big lot -> farmfresh (big or small grade does not matter)", classifySale({ category: "sale", label: "Buy", eggs: 36330 }), "farmfresh");
eq("classify: label says local -> local", classifySale({ category: "sale", label: "Local sale", eggs: 900 }), "local");
eq("classify: a small lot of 120 eggs is never Farmfresh", classifySale({ category: "sale", label: "Sale", eggs: 120 }), "local");
eq("classify: 150 eggs is still a small lot; 180 is not", [classifySale({ category: "sale", label: "Sale", eggs: 150 }), classifySale({ category: "sale", label: "Sale", eggs: 180 })], ["local", "farmfresh"]);
// V9 J9: the owner's own price list is his NET selling price; stored BAFTA rate = list + 0.03
{
  const list = parseNetPriceList("19 Oct 2026  5.22\n20-10-2026 5.30\n2026-10-21: ₹5.41");
  eq("price list: three lines, three dates", list.map((r) => r.date), ["2026-10-19", "2026-10-20", "2026-10-21"]);
  eq("price list: 5.22 net is stored as BAFTA 5.25 (per100 525, no subsidy)", [list[0].per100, list[0].subsidyPaise], [525, 0]);
  const n = rateNumbers(list[0].per100, list[0].subsidyPaise);
  eq("price list: Farmfresh gets exactly the owner's 5.22 back, local 5.26", [n.effective, n.farmfresh, n.local], [5.25, 5.22, 5.26]);
  eq("price list: a line with no price is skipped", parseNetPriceList("19 Oct 2026").length, 0);
  eq("price list: day number is not mistaken for the price", parseNetPriceList("5 Oct 2026 5.1").map((r) => r.per100), [513]);
  eq("a BAFTA message is still read as the raw rate (RS.560 -> 5.60 less nothing)", one("OCTOBER 19, 2026 BFTA EGG RATE RS.560/- Subsidy for 0 Paise"), [["2026-10-19", 560, 0]]);
}
process.exit(failed ? 1 : 0);
