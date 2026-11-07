// Tests of the V14 medicines work: the master list, entries for several flocks, boosters every 6 months, the chick plan, the import, grouped
// alerts, matching of old lines and the cost flow.   npx tsx scripts/medicines-v14-check.mts
// Part 1 is pure (no database). Part 2 reads and writes the database in DATABASE_URL (default: the local copy) and leaves nothing behind;
// it is SKIPPED (not failed) when the database cannot be reached.
import pg from "pg";
import { lookup, pickable, searchItems, validateAlias, validateItem, type CatalogueItem } from "../lib/medicines/catalogue.ts";
import { describeSplit, planEntry, splitTotal, validateEntry, type EntryFlock } from "../lib/medicines/entry.ts";
import { addMonths, boosterAlerts, boosterFor, boosterTable, boosterWords, type GivenLine, type LayingFlock, type RuleDef } from "../lib/medicines/boosters.ts";
import { buildPlan, chickAlerts, groupDays, stepStatus, type TemplateRow } from "../lib/medicines/chickPlan.ts";
import { importDates, lineKey, parseImport, IMPORT_TEMPLATE, type ImportCtx, type ImportFlock } from "../lib/medicines/import.ts";

let failed = 0;
const ok = (n: string, c: boolean, x = "") => {
  if (!c) failed++;
  console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : "  " + x}`);
};
const TODAY = "2026-11-07";

// ============================== the master list ===========================================================================================
let nextId = 1;
const mk = (name: string, kind: CatalogueItem["kind"], over: Partial<CatalogueItem> = {}, aliases: string[] = []): CatalogueItem => ({
  id: nextId++, name, kind, purpose: null, route: null, dose: null, brand: null, unit: null, active: true, needsConfirmation: false, note: null, aliases: aliases.map((a, i) => ({ id: i + 1, alias: a })), used: 0, ...over,
});
const items: CatalogueItem[] = [
  mk("Croyza", "vaccine", { purpose: "Infectious coryza", needsConfirmation: true }, ["Coryza", "Coriza"]),
  mk("MA5", "vaccine", { purpose: "Infectious bronchitis (IB)" }, ["MAS"]),
  mk("Levofloxacin", "medicine", { purpose: "Antibiotic", route: "water" }, ["Lufofloxin"]),
  mk("Debeaking", "management"),
  mk("Old tonic", "medicine", { active: false }),
  mk("NDIB", "vaccine", { brand: "Ceva", needsConfirmation: true }),
];
const byName = (n: string) => items.find((i) => i.name === n)!;

ok("list: a name is found whatever its capital letters and spaces; an other spelling finds the same item", lookup(items, " croyza ")?.item.name === "Croyza" && lookup(items, "CORYZA")?.via === "alias" && lookup(items, "Coriza")?.item.id === byName("Croyza").id && lookup(items, "lufofloxin")?.item.name === "Levofloxacin" && lookup(items, "MAS")?.item.name === "MA5");
ok("list: an unknown or empty name is not found", lookup(items, "Vitamin C") === null && lookup(items, "   ") === null && lookup(items, null) === null);
ok("list: a new item whose name already exists (any spelling) is refused in plain words and says which item", (() => { const a = validateItem({ name: "croyza", kind: "vaccine" }, items); const b = validateItem({ name: "Coryza", kind: "vaccine" }, items); return !a.ok && /already in the list/.test(a.errors.join()) && !b.ok && /another spelling of “Croyza”/.test(b.errors.join()); })());
ok("list: a good new item is accepted, trimmed, and keeps only what the owner said (no invented dose or brand)", (() => { const r = validateItem({ name: "  Liver   tonic ", kind: "medicine", purpose: "Liver", route: "water" }, items); return r.ok && r.item.name === "Liver tonic" && r.item.dose === null && r.item.brand === null && r.item.route === "water"; })());
ok("list: empty name, bad type, bad route and over-long name are each refused", !validateItem({ name: "", kind: "vaccine" }, items).ok && !validateItem({ name: "X", kind: "potion" }, items).ok && !validateItem({ name: "X", kind: "vaccine", route: "nose" }, items).ok && !validateItem({ name: "x".repeat(81), kind: "vaccine" }, items).ok);
ok("list: editing an item may keep its own name", validateItem({ name: "Croyza", kind: "vaccine" }, items, byName("Croyza").id).ok);
ok("list: an other spelling cannot be a name, another item's spelling, or already this item's", (() => {
  const own = validateAlias("Croyza", items, byName("Croyza").id);
  const otherName = validateAlias("MA5", items, byName("Croyza").id);
  const otherAlias = validateAlias("MAS", items, byName("Croyza").id);
  const fine = validateAlias("Coryza II", items, byName("Croyza").id);
  return !own.ok && !otherName.ok && !otherAlias.ok && /“MA5”/.test(otherAlias.ok ? "" : otherAlias.error) && fine.ok;
})());
ok("list: the pick list has no tasks and no inactive items, vaccines first", (() => { const p = pickable(items); return !p.some((i) => i.kind === "management" || !i.active) && p[0].kind === "vaccine" && p[p.length - 1].kind === "medicine"; })());
ok("list: search finds by name, other spelling, disease or brand", searchItems(items, "coryza").length === 1 && searchItems(items, "bronchitis")[0].name === "MA5" && searchItems(items, "ceva")[0].name === "NDIB" && searchItems(items, "").length === items.length && searchItems(items, "zzz").length === 0);

// ============================== an entry for several flocks ===============================================================================
const fl: EntryFlock[] = [
  { id: "f1", label: "BAB-1", birds: 6457 },
  { id: "f2", label: "BAB-2", birds: 9584 },
  { id: "f3", label: "BAB-3", birds: 11347 },
  { id: "f9", label: "BAB-9", birds: null },
];
const raw = { date: "2026-10-20", catalogue_id: String(byName("Levofloxacin").id), flock_ids: ["f1", "f2", "f3"], quantity: "3", unit: "bottles", cost: "1000", supplier: "Kisan Vet", note: "5 days" };
const v = validateEntry(raw, items, fl, TODAY);
ok("entry: a complete entry from the list with three ticked flocks is accepted", v.ok && v.entry.choice.item?.name === "Levofloxacin" && v.entry.flockIds.length === 3 && v.entry.cost === 1000 && v.entry.quantity === 3);
ok("entry: no item, no flock, a flock that is not in the app, a future date, a bad cost, a quantity without a unit are each refused in words", (() => {
  const e = (o: object) => { const r = validateEntry({ ...raw, ...o }, items, fl, TODAY); return r.ok ? "" : r.errors.join(" "); };
  return /Pick the medicine/.test(e({ catalogue_id: "" })) && /Tick at least one flock/.test(e({ flock_ids: [] })) && /not in the app/.test(e({ flock_ids: ["zz"] })) && /future/.test(e({ date: "2026-12-01" })) && /cost must be a number/.test(e({ cost: "abc" })) && /unit/.test(e({ unit: "" }));
})());
ok("entry: a farm task or an item taken out of the pick list cannot be entered", (() => { const t = validateEntry({ ...raw, catalogue_id: String(byName("Debeaking").id) }, items, fl, TODAY); const o = validateEntry({ ...raw, catalogue_id: String(byName("Old tonic").id) }, items, fl, TODAY); return !t.ok && /farm task/.test(t.errors.join()) && !o.ok && /pick list/.test(o.errors.join()); })());
ok("entry: a new name typed in is accepted as a NEW item (to be added as to confirm); a name that is already in the list uses the list item instead", (() => {
  const a = validateEntry({ ...raw, catalogue_id: "", new_name: "Calcium liquid", new_kind: "medicine" }, items, fl, TODAY);
  const b = validateEntry({ ...raw, catalogue_id: "", new_name: "coryza", new_kind: "vaccine" }, items, fl, TODAY);
  const c = validateEntry({ ...raw, catalogue_id: "", new_name: "Calcium liquid", new_kind: "" }, items, fl, TODAY);
  return a.ok && a.entry.choice.create?.name === "Calcium liquid" && a.entry.choice.item === null && b.ok && b.entry.choice.item?.name === "Croyza" && /already in the list/.test(b.entry.choice.note ?? "") && !c.ok;
})());

ok("split: 1000 rupees over three flocks of equal weight is 333.34 + 333.33 + 333.33 and adds up to exactly 1000.00", (() => { const p = splitTotal(1000, [1, 1, 1], 2); return p.join() === "333.34,333.33,333.33" && Math.round(p.reduce((s, x) => s + x, 0) * 100) === 100000; })());
ok("split: by birds the parts follow the sizes and always add up to the total (many random cases)", (() => {
  let good = true;
  for (let n = 0; n < 500; n++) {
    const k = 2 + (n % 9);
    const w = Array.from({ length: k }, (_, i) => 1 + ((n * 7919 + i * 104729) % 12000));
    const total = Math.round((1 + ((n * 31) % 5000)) * 100 + (n % 100)) / 100;
    const parts = splitTotal(total, w, 2);
    const sum = Math.round(parts.reduce((s, x) => s + x * 100, 0));
    if (sum !== Math.round(total * 100) || parts.some((x) => x < 0) || parts.length !== k) good = false;
    const big = w.indexOf(Math.max(...w));
    const small = w.indexOf(Math.min(...w));
    if (w[big] > w[small] * 1.5 && parts[big] < parts[small]) good = false;
  }
  return good;
})());
ok("split: quantities use three decimals and still add up (3 bottles over 6457 / 9584 / 11347 birds)", (() => { const p = splitTotal(3, [6457, 9584, 11347], 3); return Math.round(p.reduce((s, x) => s + x * 1000, 0)) === 3000 && p[2] > p[1] && p[1] > p[0]; })());
ok("split: zero or empty weights fall back to equal shares and never fail", splitTotal(10, [0, 0], 2).join() === "5,5" && splitTotal(10, [], 2).length === 0);
const plan3 = planEntry({ flockIds: ["f1", "f2", "f3"], quantity: 3, cost: 1000 }, fl);
ok("plan: three flocks with bird counts are split BY BIRDS; the lines add up to the typed totals; each flock has its own line", plan3.basis === "birds" && plan3.parts.length === 3 && Math.round(plan3.parts.reduce((s, p) => s + p.cost! * 100, 0)) === 100000 && Math.round(plan3.parts.reduce((s, p) => s + p.quantity! * 1000, 0)) === 3000 && plan3.parts[2].cost! > plan3.parts[0].cost!);
const planEq = planEntry({ flockIds: ["f1", "f9"], quantity: null, cost: 500 }, fl);
ok("plan: a flock with an unknown bird count makes the split EQUAL and says so; a missing quantity stays empty", planEq.basis === "equal" && planEq.parts.map((p) => p.cost).join() === "250,250" && planEq.parts.every((p) => p.quantity === null) && /equally/.test(describeSplit(planEq, null)));
const plan1 = planEntry({ flockIds: ["f2"], quantity: 2, cost: null }, fl);
ok("plan: one flock gets the typed figures as they are (no split); no cost stays 'not entered' (null, never 0)", plan1.basis === null && plan1.parts.length === 1 && plan1.parts[0].quantity === 2 && plan1.parts[0].cost === null && describeSplit(plan1, "vials") === "");
ok("plan: the sentence on screen says how the totals were shared and names each flock", (() => { const t = describeSplit(plan3, "bottles"); return /^The cost ₹1,000 and the quantity 3 bottles was split by the number of birds/.test(t) && /BAB-1/.test(t) && /BAB-3/.test(t); })());

// ============================== boosters every 6 months ===================================================================================
ok("months: month ends are clamped (31 Aug + 6 = 28 Feb; 31 Aug 2027 + 6 = 29 Feb 2028; 31 Mar + 6 = 30 Sep)", addMonths("2026-08-31", 6) === "2027-02-28" && addMonths("2027-08-31", 6) === "2028-02-29" && addMonths("2026-03-31", 6) === "2026-09-30");
ok("months: leap day and year ends (29 Feb 2028 + 6 = 29 Aug 2028; 29 Feb 2028 + 12 = 28 Feb 2029; 15 Dec + 6 = 15 Jun next year; 31 Jan + 1 = 28 Feb)", addMonths("2028-02-29", 6) === "2028-08-29" && addMonths("2028-02-29", 12) === "2029-02-28" && addMonths("2026-12-15", 6) === "2027-06-15" && addMonths("2026-01-31", 1) === "2026-02-28");
const ND: RuleDef = { id: 1, code: "nd", label: "ND booster", repeatMonths: 6, itemIds: [101, 102], mainItemId: 101 };
const LP: RuleDef = { id: 2, code: "lpai", label: "LPAI booster", repeatMonths: 6, itemIds: [103], mainItemId: 103 };
const F: LayingFlock[] = Array.from({ length: 11 }, (_, i) => ({ id: `f${i + 1}`, label: `BAB-${i + 1}`, shed: i < 8 ? "Shed A" : "Shed B", segment: i < 8 ? "main" : "young" }));
const line = (flock: string | null, date: string, id = 101, scope: GivenLine["scope"] = "flock", shed: string | null = null): GivenLine => ({ scope, flockId: flock, shedCode: shed, date, catalogueId: id });
ok("booster: NO recorded date = 'last date not entered' (amber, no next date, no days) - never done", (() => { const c = boosterFor(ND, F[0], [], TODAY); return c.status === "no_date" && c.next === null && c.daysToDue === null && c.last === null && /not entered/.test(boosterWords(c, (d) => d)); })());
ok("booster: next due = last given + 6 months; 14 days is 'soon', 15 days is 'done', today is due today, yesterday is overdue by 1 day", (() => {
  const at = (last: string) => boosterFor(ND, F[0], [line("f1", last)], TODAY);
  // today 2026-11-07: next due 2026-11-21 (14 days) / 2026-11-22 (15) / 2026-11-07 (0) / 2026-11-06 (-1)
  const a = at("2026-05-21"), b = at("2026-05-22"), c = at("2026-05-07"), d = at("2026-05-06");
  return a.status === "soon" && a.daysToDue === 14 && b.status === "done" && b.daysToDue === 15 && c.status === "soon" && c.daysToDue === 0 && d.status === "overdue" && d.daysToDue === -1;
})());
ok("booster: the latest of several dates counts; a date in the future and a line of a different vaccine do not", (() => { const c = boosterFor(ND, F[0], [line("f1", "2025-11-01"), line("f1", "2026-09-01"), line("f1", "2026-12-30"), line("f1", "2026-10-30", 999)], TODAY); return c.last === "2026-09-01" && c.next === "2027-03-01" && c.status === "done"; })());
ok("booster: any list item ticked as counting for the rule counts (102 counts as ND, 103 does not)", boosterFor(ND, F[0], [line("f1", "2026-09-01", 102)], TODAY).last === "2026-09-01" && boosterFor(ND, F[0], [line("f1", "2026-09-01", 103)], TODAY).last === null);
ok("booster: another flock's line does not count; a whole-farm line counts for every flock; a shed line only for that shed", (() => {
  const other = boosterFor(ND, F[1], [line("f1", "2026-09-01")], TODAY).last;
  const farm = boosterFor(ND, F[9], [line(null, "2026-09-01", 101, "farm")], TODAY).last;
  const shedA = boosterFor(ND, F[0], [line(null, "2026-09-01", 101, "shed", "Shed A")], TODAY).last;
  const shedB = boosterFor(ND, F[0], [line(null, "2026-09-01", 101, "shed", "Shed B")], TODAY).last;
  return other === null && farm === "2026-09-01" && shedA === "2026-09-01" && shedB === null;
})());
ok("booster words: done, due in N days, overdue by N days read in plain words", (() => { const f = (d: string) => d; const w = (last: string) => boosterWords(boosterFor(ND, F[0], [line("f1", last)], TODAY), f); return /^Done 2026-09-01, next due 2027-03-01$/.test(w("2026-09-01")) && /^Due in 8 days/.test(w("2026-05-15")) && /^18 days overdue/.test(w("2026-04-20")); })());

const tbl = (lines: GivenLine[]) => boosterTable([ND, LP], F, lines, TODAY);
ok("alerts: all 11 flocks with no date give ONE line (not 22), and no overdue line", (() => { const a = boosterAlerts(tbl([]), [ND, LP], TODAY); return a.length === 1 && a[0].id === "booster-no-date" && /11 flocks/.test(a[0].title); })());
ok("alerts: all 11 flocks overdue for both vaccines give two lines plus nothing else: never one per flock", (() => {
  const lines = F.flatMap((f) => [line(f.id, "2026-03-01", 101), line(f.id, "2026-03-01", 103)]);
  const a = boosterAlerts(tbl(lines), [ND, LP], TODAY);
  return a.length === 2 && a.every((x) => /overdue for 11 flocks/.test(x.title)) && /and 6 more/.test(a[0].detail);
})());
ok("alerts: one line per vaccine joins overdue and due-soon flocks, worst first, and a flock that is fine is not mentioned", (() => {
  const lines = [line("f1", "2026-04-20"), line("f2", "2026-05-15"), line("f3", "2026-09-01"), ...F.slice(3).map((f) => line(f.id, "2026-09-01"))];
  const a = boosterAlerts(boosterTable([ND], F, lines, TODAY), [ND], TODAY);
  return a.length === 1 && /overdue for 1 flock and due soon for 1/.test(a[0].title) && /BAB-1 \(18 days\)/.test(a[0].detail) && /BAB-2 \(15 Nov 2026\)/.test(a[0].detail) && !/BAB-3/.test(a[0].detail);
})());
ok("alerts: nothing due, nothing missing gives no line at all", boosterAlerts(boosterTable([ND], F, F.map((f) => line(f.id, "2026-10-01")), TODAY), [ND], TODAY).length === 0);

// ============================== the chick plan ============================================================================================
const T = (id: number, dayFrom: number, dayTo: number | null, name: string, kind: TemplateRow["kind"] = "vaccine", needsConfirmation = false): TemplateRow => ({ id, dayFrom, dayTo, catalogueId: id, name, kind, purpose: null, note: null, needsConfirmation, sort: id });
const tpl: TemplateRow[] = [T(1, 1, null, "MD", "vaccine", true), T(2, 1, null, "Nuvaimmune"), T(3, 9, null, "Debeaking", "management"), T(4, 18, 20, "ND-Variant"), T(5, 105, null, "NDIB", "vaccine", true)];
const plan = buildPlan(tpl, "2026-12-01");
ok("plan: day 1 is the arrival date; day 9 is 8 days later; a window runs day 18 to 20; day 105 is 104 days after arrival", plan[0].due === "2026-12-01" && plan.find((s) => s.name === "Debeaking")!.due === "2026-12-09" && plan.find((s) => s.name === "ND-Variant")!.due === "2026-12-18" && plan.find((s) => s.name === "ND-Variant")!.windowEnd === "2026-12-20" && plan.find((s) => s.name === "NDIB")!.due === "2027-03-15");
ok("plan: crossing a leap day (arrival 20 Feb 2028, day 18 = 8 Mar 2028) and a task is marked as a task, a guess as 'to confirm'", (() => { const p = buildPlan(tpl, "2028-02-20"); return p.find((s) => s.name === "ND-Variant")!.due === "2028-03-08" && p.find((s) => s.name === "Debeaking")!.isTask && p[0].needsConfirmation && !p.find((s) => s.name === "Nuvaimmune")!.needsConfirmation; })());
ok("plan: steps of the same day are grouped under one day", (() => { const g = groupDays(plan); return g.length === 4 && g[0].steps.length === 2 && g[0].dayFrom === 1 && g[2].dayTo === 20; })());
ok("plan: a step is done when given, overdue after its day (or the end of its window), due now inside the window, soon within 14 days, otherwise later", stepStatus("2026-11-01", null, "2026-11-03", TODAY) === "done" && stepStatus("2026-11-01", null, null, TODAY) === "overdue" && stepStatus("2026-11-05", "2026-11-09", null, TODAY) === "now" && stepStatus("2026-11-05", "2026-11-06", null, TODAY) === "overdue" && stepStatus("2026-11-21", null, null, TODAY) === "soon" && stepStatus("2026-11-22", null, null, TODAY) === "later" && stepStatus(TODAY, null, null, TODAY) === "now");
ok("chick alerts: ONE line per batch that has a plan, a batch with no plan gives none, a finished batch gives none", (() => {
  const a = chickAlerts([
    { id: 3, arrival: "2026-09-18", steps: [{ name: "MD", due: "2026-09-18", windowEnd: null, givenDate: null }, { name: "ND", due: "2026-09-22", windowEnd: null, givenDate: null }, { name: "N.D.K", due: "2026-11-14", windowEnd: null, givenDate: null }] },
    { id: 4, arrival: "2026-12-10", steps: [] },
    { id: 2, arrival: "2026-06-06", steps: [{ name: "MD", due: "2026-06-06", windowEnd: null, givenDate: "2026-06-06" }] },
  ], TODAY);
  return a.length === 1 && /day 51/.test(a[0].title) && /2 steps overdue, 1 due soon/.test(a[0].title) && /N\.D\.K/.test(a[0].detail);
})());

// ============================== the import ================================================================================================
const IF: ImportFlock[] = [
  { id: "f1", label: "BAB-1", segment: "main", shed: "Shed A" },
  { id: "f2", label: "BAB-2", segment: "main", shed: "Shed A" },
  { id: "f9", label: "BAB-9", segment: "young", shed: "Shed B" },
];
const birdsOf: Record<string, number> = { f1: 6000, f2: 4000, f9: 2000 };
const ctx = (over: Partial<ImportCtx> = {}): ImportCtx => ({ items, flocks: IF, birds: (_d, id) => birdsOf[id] ?? null, existing: new Set(), mapping: {}, today: TODAY, ...over });
const csv = `date,name,flock,quantity,unit,cost,supplier,note
2026-09-10,Levofloxacin,BAB-1; BAB-2,3,bottles,1000,Kisan Vet,5 days
2026-09-12,Coryza,main,,,,,
2026-09-15,Croyza,all,,,,,
2026-09-20,Liver tonic,BAB-9,2,bottles,300,,
2026-09-21,Levofloxacin,BAB-99,1,bottle,100,,
2026-12-25,Levofloxacin,BAB-1,1,bottle,1,,
2026-09-22,Debeaking,BAB-1,,,,,
2026-09-10,Levofloxacin,BAB-1,3,bottles,1000,,
2026-09-23,Levofloxacin,Shed B,1,,,,
`;
const rep = parseImport(csv, ctx());
const st = rep.rows.map((r) => r.state);
ok("import: a list name works; an other spelling works and says so; main / all expand to the flocks; a total cost is split by birds exactly", st[0] === "ok" && st[1] === "ok" && st[2] === "ok" && rep.rows[1].warnings.some((w) => /another spelling of “Croyza”/.test(w)) && rep.rows[1].plan!.parts.length === 2 && rep.rows[2].plan!.parts.length === 3 && rep.rows[0].plan!.parts.map((p) => p.cost).join() === "600,400" && rep.rows[0].plan!.basis === "birds");
ok("import: a name the list does not know is 'unknown', listed ONCE with its rows, and nothing is created", st[3] === "unknown" && rep.unknown.length === 1 && rep.unknown[0].name === "Liver tonic" && rep.unknown[0].rows.join() === "5" && rep.rows[3].item === null);
ok("import: unknown flock, future date, a farm task, a line repeated in the file and a quantity without a unit are errors in plain words", st[4] === "error" && /BAB-99/.test(rep.rows[4].errors.join()) && st[5] === "error" && /future/.test(rep.rows[5].errors.join()) && st[6] === "error" && /farm task/.test(rep.rows[6].errors.join()) && st[7] === "error" && /twice/.test(rep.rows[7].errors.join()) && st[8] === "error" && /unit/.test(rep.rows[8].errors.join()));
ok("import: the owner's answers for an unknown name work: match to a list item, add as a NEW item (flagged create), or leave out", (() => {
  const key = "liver tonic";
  const m = parseImport(csv, ctx({ mapping: { [key]: `item:${byName("Levofloxacin").id}` } })).rows[3];
  const n = parseImport(csv, ctx({ mapping: { [key]: "new:medicine" } })).rows[3];
  const s = parseImport(csv, ctx({ mapping: { [key]: "skip" } }));
  return m.state === "ok" && m.item!.name === "Levofloxacin" && !m.item!.create && n.state === "ok" && n.item!.create && n.item!.kind === "medicine" && n.item!.name === "Liver tonic" && s.rows[3].state === "skipped" && s.counts.unknown === 0 && s.counts.skipped === 1;
})());
ok("import: a line already in the register (same date, item and flock) is 'exists' and not imported again", (() => { const ex = new Set([lineKey("2026-09-12", byName("Croyza").id, "Croyza", "f2")]); const r = parseImport(csv, ctx({ existing: ex })); return r.rows[1].state === "exists" && r.counts.exists === 1; })());
ok("import: counts add up and the dates of the file are listed for the bird counts", rep.counts.total === 9 && rep.counts.ok === 3 && rep.counts.unknown === 1 && rep.counts.error === 5 && importDates(csv).length === 8 && importDates(csv).includes("2026-09-10"));
ok("import: an empty flock cell means the whole farm and says so; flock names are not case sensitive; a shed name means its flocks; a bad date and a missing column are reported", (() => {
  const r = parseImport("date,name,flock\n2026-09-10,ND-Killed,\n2026-09-11,MA5,bab-9\n2026-09-12,MA5,Shed A\nxx,MA5,BAB-1\n", ctx({ items: [...items, mk("ND-Killed", "vaccine")] }));
  const missing = parseImport("date,flock\n2026-01-01,BAB-1", ctx());
  return r.rows[0].state === "ok" && r.rows[0].plan!.parts.length === 3 && r.rows[0].warnings.some((w) => /whole farm/.test(w)) && r.rows[1].plan!.parts[0].label === "BAB-9" && r.rows[2].plan!.parts.length === 2 && r.rows[3].state === "error" && missing.columnProblems.length === 1;
})());
ok("import: the template's three example rows are all fine against a list that has those items", (() => {
  const t = [...items, mk("ND booster (lay)", "vaccine"), mk("Fowlpox", "vaccine")];
  const r = parseImport(IMPORT_TEMPLATE, ctx({ items: t }));
  return r.counts.ok === 3 && r.counts.error === 0 && r.rows[0].item!.name === "Levofloxacin";
})());

// ============================== the database (leaves nothing behind) ======================================================================
const dbUrl = process.env.DATABASE_URL ?? "postgres://yash:yash_dev_password@localhost:5432/yash_poultry";
const pool = new pg.Pool({ connectionString: dbUrl, max: 2 });
let dbUp = false;
try {
  await pool.query("select 1 from medicine_catalogue limit 1");
  dbUp = true;
} catch {
  console.log("SKIPPED  database checks (the database, or migrations 0049 to 0051, are not there)");
}
if (dbUp) {
  const { listCatalogue, matchOldLines } = await import("../lib/medicines/catalogueStore.ts");
  const { listTemplate } = await import("../lib/medicines/chickStore.ts");
  const { insertLine, matchLinesByName } = await import("../lib/medicines/store.ts");
  const { loadCostInput } = await import("../lib/costs/load.ts");
  const c = await pool.connect();
  try {
    const all = await listCatalogue(c);
    const named = (n: string) => all.find((i) => i.name === n);
    ok(`seed: ${all.length >= 22 ? "22" : all.length} items from the owner's schedule are in the list, every vaccine he named once`, all.length >= 22 && ["MD", "Nuvaimmune", "IBD", "VitabrownL", "ND", "ND-Variant", "ND-Killed", "IBD booster (standard or B2K)", "Fowlpox", "MA5", "LASOTA", "Croyza", "R6", "R8", "N.D.K", "CLONE30", "NDIB", "Levofloxacin"].every((n) => named(n)));
    ok("seed: exactly the guesses the owner marked are 'to confirm' (MD, IBD, LASOTA, Croyza, N.D.K spelling, NDIB, and the two booster items); the confirmed ones are not", (() => { const tc = all.filter((i) => i.needsConfirmation).map((i) => i.name).sort(); return tc.join("|") === ["Croyza", "IBD", "LASOTA", "LPAI booster (lay)", "MD", "N.D.K", "ND booster (lay)", "NDIB"].sort().join("|") && !named("Nuvaimmune")!.needsConfirmation && !named("VitabrownL")!.needsConfirmation && !named("MA5")!.needsConfirmation; })());
    ok("seed: only what the owner said is filled: VitabrownL is an eye drop, Levofloxacin is a water medicine 'when needed' (also written Lufofloxin), N.D.K keeps the brand as he wrote it, NDIB brand Ceva, no invented doses", named("VitabrownL")!.route === "eye_drop" && named("Levofloxacin")!.route === "water" && named("Levofloxacin")!.kind === "medicine" && /when needed/.test(named("Levofloxacin")!.note ?? "") && named("Levofloxacin")!.aliases.some((a) => a.alias === "Lufofloxin") && named("N.D.K")!.brand === "HUUESHEILD" && named("NDIB")!.brand === "Ceva" && all.every((i) => i.dose === null) && named("MA5")!.aliases.some((a) => a.alias === "MAS") && named("Croyza")!.aliases.some((a) => a.alias === "Coryza"));
    ok("seed: debeaking and nail cutting are farm tasks (not medicines); the two lay boosters exist as vaccines to confirm", named("Debeaking")!.kind === "management" && named("Nail cutting")!.kind === "management" && named("ND booster (lay)")!.kind === "vaccine" && named("LPAI booster (lay)")!.needsConfirmation);
    const tmpl = await listTemplate(c);
    const days = [...new Set(tmpl.map((t) => t.dayFrom))];
    ok("chick schedule: the owner's 16 steps (days 1, 5, 9, 18-20, 23, 27, 34, 37, 39, 46, 58, 66, 75, 83, 102, 105) are stored as 25 list-linked rows; debeaking on day 9, nail cutting on day 39", tmpl.length === 25 && days.join() === "1,5,9,18,23,27,34,37,39,46,58,66,75,83,102,105" && tmpl.find((t) => t.name === "Debeaking")!.dayFrom === 9 && tmpl.find((t) => t.name === "Nail cutting")!.dayFrom === 39 && tmpl.find((t) => t.name === "ND-Variant")!.dayTo === 20);
    const real = buildPlan(tmpl, "2026-12-01");
    ok("chick schedule: from an arrival on 1 Dec 2026 day 1 is 1 Dec, day 105 is 15 Mar 2027, and the first day has the four vaccines in the owner's order", real[0].due === "2026-12-01" && real.filter((s) => s.dayFrom === 1).map((s) => s.name).join() === "MD,Nuvaimmune,IBD,VitabrownL" && real[real.length - 1].name === "NDIB" && real[real.length - 1].due === "2027-03-15");

    // the database keeps one word for one item
    await c.query("BEGIN");
    const dup = await c.query("INSERT INTO medicine_catalogue (name, kind) VALUES (' md ', 'vaccine')").then(() => "inserted", (e) => (e as { code?: string }).code);
    await c.query("ROLLBACK");
    await c.query("BEGIN");
    const aliasAsName = await c.query("INSERT INTO medicine_aliases (catalogue_id, alias) SELECT id, 'nd' FROM medicine_catalogue WHERE name = 'MA5'").then(() => "inserted", (e) => (e as { code?: string }).code);
    await c.query("ROLLBACK");
    await c.query("BEGIN");
    const nameAsAlias = await c.query("INSERT INTO medicine_catalogue (name, kind) VALUES ('coriza', 'vaccine')").then(() => "inserted", (e) => (e as { code?: string }).code);
    await c.query("ROLLBACK");
    ok("database: a name exists once whatever its capital letters and spaces; an other spelling cannot be a name; a name cannot be someone's other spelling", dup === "23505" && aliasAsName === "23505" && nameAsAlias === "23505", `${dup} ${aliasAsName} ${nameAsAlias}`);

    // matching of old typed lines (inside a transaction, rolled back)
    await c.query("BEGIN");
    const lineIn = (item: string, kind: "medicine" | "vaccine") => insertLine(c, { scope: "farm", flockId: null, shedCode: null, date: "2026-10-01", kind, item, quantity: null, unit: null, cost: null, supplier: null, note: "v14-check" }, null, "v14-check");
    const a = await lineIn("lasota", "vaccine"), b = await lineIn("  Coriza ", "vaccine"), d = await lineIn("Mystery drops", "medicine"), e = await lineIn("Lasota", "medicine");
    const n = await matchOldLines(c);
    const got = async (id: number) => { const v = (await c.query("SELECT catalogue_id FROM medicine_lines WHERE id = $1", [id])).rows[0].catalogue_id; return v == null ? null : Number(v); };
    ok("old lines: an exact name or other spelling is matched by itself (lasota → LASOTA, ' Coriza ' → Croyza); an unknown name and a name with the wrong type stay unmatched", n === 2 && (await got(a)) === named("LASOTA")!.id && (await got(b)) === named("Croyza")!.id && (await got(d)) === null && (await got(e)) === null, String(n));
    const matched = await matchLinesByName("Mystery drops", named("Levofloxacin")!.id, c);
    ok("old lines: the one-tap match gives every line with that name the list item and its type, only once", matched === 1 && (await got(d)) === named("Levofloxacin")!.id && (await matchLinesByName("Mystery drops", named("Levofloxacin")!.id, c)) === 0);
    await c.query("ROLLBACK");
  } finally {
    c.release();
  }

  // cost flow: committed rows with a marker, removed at the end
  const flockRows = (await pool.query("SELECT flock_internal_id FROM flocks WHERE status = 'active' ORDER BY display_label LIMIT 3")).rows.map((r) => r.flock_internal_id as string);
  try {
    const vacc = (await pool.query("SELECT id FROM medicine_catalogue WHERE name = 'Croyza'")).rows[0].id as number;
    const med = (await pool.query("SELECT id FROM medicine_catalogue WHERE name = 'Levofloxacin'")).rows[0].id as number;
    const parts = splitTotal(1000, [1, 1, 1], 2);
    for (let i = 0; i < 3; i++) await insertLine(pool, { scope: "flock", flockId: flockRows[i], shedCode: null, date: "2031-03-10", kind: "vaccine", item: "Croyza", quantity: null, unit: null, cost: parts[i], supplier: null, note: "v14-check", catalogueId: vacc, entryGroup: "v14-check-group", costTotal: 1000, splitBasis: "equal" }, null, "v14-check");
    await insertLine(pool, { scope: "flock", flockId: flockRows[0], shedCode: null, date: "2031-03-11", kind: "medicine", item: "Levofloxacin", quantity: 2, unit: "bottles", cost: null, supplier: null, note: "v14-check", catalogueId: med }, null, "v14-check");
    const cost = await loadCostInput();
    const mine = cost.purchases.filter((p) => String(p.date).startsWith("2031-03"));
    ok("cost flow: the per-flock lines of one entry reach Costs as vaccine cost and add up to the typed total (₹1,000.00); a line with no cost adds nothing and is not zero", mine.length === 3 && mine.every((p) => p.category === "vaccine") && Math.round(mine.reduce((s, p) => s + p.amount * 100, 0)) === 100000, JSON.stringify(mine));
    const one = await pool.query("SELECT count(*)::int AS n, sum(amount_inr) AS s, count(*) FILTER (WHERE amount_inr IS NULL)::int AS nocost FROM medicine_lines WHERE note = 'v14-check'");
    ok("cost flow: per-flock reports are exact (3 lines of the entry, one line per flock, together ₹1,000.00, one extra line with 'cost not entered')", one.rows[0].n === 4 && Number(one.rows[0].s) === 1000 && one.rows[0].nocost === 1);
  } finally {
    await pool.query("DELETE FROM medicine_lines WHERE note = 'v14-check'");
  }
  const left = await pool.query("SELECT count(*)::int AS n FROM medicine_lines WHERE note = 'v14-check'");
  ok("the check left nothing behind in the database", left.rows[0].n === 0);
}
await pool.end();

console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
