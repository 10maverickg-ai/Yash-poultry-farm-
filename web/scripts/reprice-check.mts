// Tests the sale recipient detection and the re-price plan (V12 N6).  npx tsx scripts/reprice-check.mts
import { repricePlan } from "../lib/rates/reprice.ts";
import { recipientFor, isRecipient, recipientLabel, RECIPIENTS } from "../lib/sales/recipients.ts";
import { salePrice } from "../lib/rates/parse.ts";

let failed = 0;
const ok = (n: string, c: boolean, x = "") => { if (!c) failed++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : "  " + x}`); };

ok("recipient: the 24 Oct line names three Yash P.F. farms -> several together", recipientFor("farmfresh", "Sale (-) to Yash P.F. (12 farm 154 + 13 farm 714 + 14 farm 623 = 1491 trays)") === "yash_farms");
ok("recipient: the 28 Oct line names Yash P.F. but no farm number -> several together", recipientFor("farmfresh", "Sale (-) to Yash P.F. (2114 trays)") === "yash_farms");
ok("recipient: a line for one farm -> that farm", recipientFor("farmfresh", "Sale (-) to Yash P.F. 13 farm") === "yash_13" && recipientFor("farmfresh", "Yash PF 12 farm 28 trays") === "yash_12");
ok("recipient: Anil farm; plain sale -> Farmfresh; local -> Local", recipientFor("local", "to Anil farm") === "anil" && recipientFor("farmfresh", "Sale (-)") === "farmfresh" && recipientFor("local", "Buy (-)") === "local");
ok("recipient: the list has the 7 owner choices plus 'several together'", RECIPIENTS.length === 8 && ["farmfresh", "local", "yash_12", "yash_13", "yash_14", "anil", "other"].every(isRecipient) && !isRecipient("nonsense") && recipientLabel("yash_14") === "Yash P.F. 14 farm" && recipientLabel(null) === "Not set");

// re-price: the 28 Oct case. The stored rate was 6.00 (owner's net selling price 5.97 + 0.03); a subsidy changes the net price to 5.90 -> stored rate 5.93
const sales = [
  { id: 105, transactionType: "sale_farmfresh", recipient: "farmfresh", buyer: "Farmfresh", grade: "big", eggs: 181440, price: 5.97, amount: 1083196.8 },
  { id: 106, transactionType: "sale_farmfresh", recipient: "yash_farms", buyer: "Farmfresh", grade: "small", eggs: 63420, price: 5.97, amount: 378617.4 },
  { id: 107, transactionType: "other", recipient: "local", buyer: "Local", grade: "small", eggs: 90, price: 6.01, amount: 540.9 },
];
const same = repricePlan(6.0, sales);
ok("re-price at the SAME rate changes nothing", same.changed === 0 && same.delta === 0, JSON.stringify([same.changed, same.delta]));
const p = repricePlan(5.93, sales);
ok("re-price at the new rate: Farmfresh = rate − 0.03 (5.90), local = rate + 0.01 (5.94)", p.rows[0].newPrice === 5.9 && p.rows[1].newPrice === 5.9 && p.rows[2].newPrice === 5.94 && p.rows[0].kind === "farmfresh" && p.rows[2].kind === "local", JSON.stringify(p.rows.map((r) => r.newPrice)));
ok("re-price: the Yash P.F. sale follows the Farmfresh rule (its recipient does not change the rule)", p.rows[1].newPrice === salePrice(5.93, "farmfresh"));
ok("re-price: before and after totals and the difference are shown", Math.abs(p.totalBefore - 1462355.1) < 0.01 && Math.abs(p.totalAfter - (181440 * 5.9 + 63420 * 5.9 + 90 * 5.94)) < 0.01 && Math.abs(p.delta - (p.totalAfter - p.totalBefore)) < 0.011 && p.changed === 3, JSON.stringify([p.totalBefore, p.totalAfter, p.delta, p.changed]));
ok("re-price: an unpriced sale is priced by the plan (and counted as a change)", repricePlan(5.93, [{ ...sales[0], price: null, amount: null }]).changed === 1);
ok("re-price: amounts are eggs x price, rounded to the paisa", p.rows[2].newAmount === Math.round(90 * 5.94 * 100) / 100);
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
