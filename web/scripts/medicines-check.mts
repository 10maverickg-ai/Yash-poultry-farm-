// Tests the medicine register logic (V12 N3): line validation, month totals, schedule groups, CSV import.  npx tsx scripts/medicines-check.mts
import { validateLine, parseTarget, targetValue, monthSummary, groupSchedule, parseImport, dupKey, IMPORT_TEMPLATE, monthsOf } from "../lib/medicines/lines.ts";

let failed = 0;
const ok = (n: string, c: boolean, x = "") => { if (!c) failed++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : "  " + x}`); };
const TODAY = "2026-10-29";
const good = { date: "2026-08-04", kind: "medicine", item: "  Enrofloxacin ", target: "flock:abc", quantity: "2", unit: "bottles", cost: "850", supplier: "Kisan Vet", note: "5 days" };

const v = validateLine(good, TODAY);
ok("line: a complete line is accepted and trimmed", v.ok && v.line.item === "Enrofloxacin" && v.line.cost === 850 && v.line.scope === "flock" && v.line.flockId === "abc", JSON.stringify(v));
const noCost = validateLine({ ...good, cost: "" }, TODAY);
ok("line: no cost is allowed and stays null (cost not entered, never 0)", noCost.ok && noCost.line.cost === null);
ok("line: cost 0 typed on purpose stays 0 (free sample)", (() => { const r = validateLine({ ...good, cost: "0" }, TODAY); return r.ok && r.line.cost === 0; })());
ok("line: future date refused with the date in the words", (() => { const r = validateLine({ ...good, date: "2026-11-02" }, TODAY); return !r.ok && /future/.test(r.errors.join()); })());
ok("line: missing name, bad kind, bad quantity, bad cost all say what is wrong", (() => { const r = validateLine({ ...good, item: "", kind: "x", quantity: "abc", cost: "-5" }, TODAY); return !r.ok && r.errors.length === 4; })());
ok("line: a quantity needs a unit", (() => { const r = validateLine({ ...good, unit: "" }, TODAY); return !r.ok && /unit/.test(r.errors.join()); })());
ok("line: 'Rs 1,250' style cost is read", (() => { const r = validateLine({ ...good, cost: "₹1,250" }, TODAY); return r.ok && r.line.cost === 1250; })());
ok("target: farm / flock / shed round trip", parseTarget("")!.scope === "farm" && targetValue(parseTarget("shed:Layer Shed 1 First")!) === "shed:Layer Shed 1 First" && parseTarget("junk") === null);

const lines = [
  { date: "2026-08-04", kind: "medicine" as const, cost: 850, targetLabel: "BAB-3" },
  { date: "2026-08-10", kind: "vaccine" as const, cost: 420, targetLabel: "Whole farm" },
  { date: "2026-08-12", kind: "medicine" as const, cost: null, targetLabel: "BAB-3" },
  { date: "2026-09-01", kind: "medicine" as const, cost: 100, targetLabel: "BAB-1" },
];
const ms = monthSummary(lines, "2026-08");
ok("month: 3 lines, cost counts only the entered costs (1,270), one line has no cost", ms.lines === 3 && ms.cost === 1270 && ms.withoutCost === 1, JSON.stringify(ms));
ok("month: per flock BAB-3 has 2 lines, 850, one without cost; per type vaccine 420", ms.byTarget.find((t) => t.label === "BAB-3")!.lines === 2 && ms.byTarget.find((t) => t.label === "BAB-3")!.withoutCost === 1 && ms.byKind.find((k) => k.kind === "vaccine")!.cost === 420);
ok("month: another month is not mixed in", monthSummary(lines, "2026-09").cost === 100 && monthsOf(lines, "2026-10").join() === "2026-10,2026-09,2026-08");

const sch = (id: number, due: string, given: string | null = null) => ({ id, vaccine: "V" + id, dueDate: due, givenDate: given, target: "BAB-9", route: null, note: null });
const g = groupSchedule([sch(1, "2026-10-01"), sch(2, "2026-10-29"), sch(3, "2026-11-12"), sch(4, "2026-11-13"), sch(5, "2026-09-01", "2026-09-03")], TODAY);
ok("schedule: overdue = due before today and not given", g.overdue.map((x) => x.id).join() === "1");
ok("schedule: due today and within 14 days = due soon (12 Nov is day 14, 13 Nov is later)", g.soon.map((x) => x.id).join() === "2,3" && g.later.map((x) => x.id).join() === "4");
ok("schedule: given = done, even if it was given late", g.done.map((x) => x.id).join() === "5");

const flocks = [{ id: "f3", label: "BAB-3" }, { id: "f1", label: "BAB-1" }];
const rep = parseImport(IMPORT_TEMPLATE, flocks, ["Layer Shed 1 First"], new Set(), TODAY);
ok("import: the template's two example lines are ok", rep.counts.ok === 2 && rep.counts.error === 0 && rep.rows[0].input!.flockId === "f3" && rep.rows[1].input!.scope === "farm", JSON.stringify(rep.counts));
const csv = `Date,Type,Name,For,Quantity,Unit,Cost,Supplier,Note
2026-07-04,medicine,Enrofloxacin,BAB-3,2,bottles,850,,
2026-07-05,Vaccine,Lasota,Layer Shed 1 First,3,vials,,,
2026-07-06,medicine,Gentamicin,BAB-99,1,bottle,100,,
2026-12-25,medicine,Future,farm,1,box,1,,
2026-07-07,tonic,Liver tonic,farm,,,,,
2026-07-04,medicine,Enrofloxacin,BAB-3,2,bottles,850,,
2026-07-08,medicine,Calcium,farm,5,kg,abc,,
04/08/2026,medicine,Vitamin,farm,1,pack,50,,
`;
const exists = new Set([dupKey({ date: "2026-08-04", kind: "medicine", item: "Vitamin", scope: "farm", flockId: null, shedCode: null, quantity: 1, unit: "pack" })]);
const r2 = parseImport(csv, flocks, ["Layer Shed 1 First"], exists, TODAY);
const st = r2.rows.map((r) => r.state);
ok("import: good line ok; shed target understood; no cost gives a warning not an error", st[0] === "ok" && st[1] === "ok" && r2.rows[1].input!.shedCode === "Layer Shed 1 First" && r2.rows[1].warnings.some((w) => /not zero/.test(w)));
ok("import: unknown flock named in plain words", st[2] === "error" && /BAB-99/.test(r2.rows[2].errors.join()));
ok("import: future date, bad type, duplicate in file and bad cost are all errors", st[3] === "error" && /future/.test(r2.rows[3].errors.join()) && st[4] === "error" && st[5] === "error" && /twice/.test(r2.rows[5].errors.join()) && st[6] === "error");
ok("import: DD/MM/YYYY date read; a line already in the register is 'exists' and not imported again", st[7] === "exists", st.join());
ok("import: counts add up", r2.counts.total === 8 && r2.counts.ok === 2 && r2.counts.exists === 1 && r2.counts.error === 5, JSON.stringify(r2.counts));
ok("import: missing columns are reported", parseImport("date,qty\n2026-01-01,1", flocks, [], new Set(), TODAY).columnProblems.length === 2);
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
