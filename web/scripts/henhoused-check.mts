// V17: hen-housed production (the breeder's definition) on the exported real rows.
//   npx tsx scripts/henhoused-check.mts <fixture-dir>
// Expected values are worked out straight from the raw rows (no engine).
/* eslint-disable @typescript-eslint/no-explicit-any -- fixture rows are untyped JSON dumps */
import { readFileSync } from "node:fs";
import { loadInput } from "./fixtureInput.mts";
import { buildCtx, diffDays } from "../lib/analytics/engine";
import { OWNER_HENS_HOUSED, flockHenHoused, groupHenHoused, hensHoused, henHousedFor, housedOn } from "../lib/analytics/henHoused";
import { makeRange, summarizeRange, type PeriodExtras } from "../lib/analytics/period";
import { compareRows, compareSide } from "../lib/analytics/compare";
import type { CostInput } from "../lib/costs/engine";

const dir = process.argv[2];
const j = (n: string) => JSON.parse(readFileSync(`${dir}/${n}.json`, "utf8"));
const input = loadInput(dir);
const ctx = buildCtx(input);
const dp: any[] = j("dp");
const mv: any[] = j("movements");
const bv: any[] = j("bv");
const flocks: any[] = j("flocks");
const idOf = (label: string) => flocks.find((f) => f.display_label === label)?.flock_internal_id as string;
const extras: PeriodExtras = { sales: [], deductions: [], birdSales: [] };
const cost: CostInput = { settings: [], purchases: [], diesel: [], prod: [], sales: [], birdSales: [] };

let bad = 0;
const ok = (name: string, cond: boolean, detail = "") => { if (!cond) bad++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  " + detail : ""}`); };
const near = (name: string, got: number | null | undefined, want: number | null, tol = 1e-9) => ok(name, got != null && want != null && Math.abs(got - want) <= tol, `got ${got} want ${want}`);
const last = ctx.dates[ctx.dates.length - 1];
const rowsOf = (id: string) => dp.filter((r) => r.flock_internal_id === id).sort((a, b) => (a.date < b.date ? -1 : 1));
const startCount = (id: string, r: any) => r.bird_population + (r.mortality ?? 0) - mv.filter((m) => m.flock_internal_id === id && m.date === r.date).reduce((s, m) => s + m.birds_change, 0);

// ---- a flock housed inside the data: BAB-9 (first row 4 Oct 2026) ----
const b9 = idOf("BAB-9");
const r9 = rowsOf(b9);
const h9 = hensHoused(ctx, b9)!;
ok("BAB-9: hens housed = birds at the start of its first register day (count + deaths − moves), from the register", h9.source === "register" && h9.date === r9[0].date && h9.count === startCount(b9, r9[0]), `${h9.count} on ${h9.date}`);
const since9 = henHousedFor(ctx, b9, last)!;
const eggs9 = r9.reduce((s, r) => s + (r.eggs_total ?? 0), 0);
const moved9 = mv.some((m) => m.flock_internal_id === b9 && ["transfer_in", "transfer_out", "unexplained_in", "unexplained_out", "count_adjustment"].includes(m.movement_type));
if (!moved9) {
  near("BAB-9: eggs per hen housed since housing = all its eggs ÷ hens housed (no birds moved)", since9.perHen, eggs9 / h9.count);
  near("BAB-9: hen-housed % since housing = eggs ÷ (hens housed × days) × 100", since9.hhPct, (eggs9 / (h9.count * r9.length)) * 100);
}
const p9 = ctx.flockById.get(b9)!.placementDate!;
const book9 = r9.reduce((s, r) => s + (bv.find((b) => b.age_weeks === Math.floor(diffDays(r.date, p9) / 7))?.cur_hhp_percent ?? NaN) / 7, 0);
near("BAB-9: the book's eggs per hen housed for the same days = sum of (BV300 current HH of that week ÷ 7)", since9.book.perHen, book9, 1e-6);
const l9 = flockHenHoused(ctx, b9, last)!.last7!;
const last7rows = r9.slice(-7);
near("BAB-9: hen-housed % over its last 7 rows", l9.hhPct, (last7rows.reduce((s, r) => s + (r.eggs_total ?? 0), 0) / (h9.count * last7rows.length)) * 100);
ok("BAB-9: hen-housed % ≤ hen-day % (deaths lower the birds alive, not the hens housed)", l9.hhPct! <= l9.hdPct! + 1e-9, `${l9.hhPct!.toFixed(2)} vs ${l9.hdPct!.toFixed(2)}`);

// ---- every young flock: register, with the book; every flock: HH never above HD unless birds were moved in ----
for (const l of ["BAB-10", "BAB-11"]) {
  const h = hensHoused(ctx, idOf(l))!;
  ok(`${l}: hens housed from the register (${h.count} on ${h.date}) and compared with the book`, h.source === "register" && henHousedFor(ctx, idOf(l), last)!.book.perHen != null);
}

// ---- a flock already laying when the data starts: a stand-in, never compared with the book ----
const b2 = idOf("BAB-2");
const h2 = hensHoused(ctx, b2)!;
const r2 = rowsOf(b2);
ok("BAB-2: stand-in = the birds at the start of 2 Jul 2026, the first day in the app", h2.source === "standin" && h2.date === ctx.dates[0] && h2.count === startCount(b2, r2[0]) && /stand-in/.test(h2.note), `${h2.count}`);
ok("BAB-2: no book comparison for a stand-in (the eggs before 2 Jul are not in the app)", henHousedFor(ctx, b2, last)!.book.perHen === null && /not known/.test(henHousedFor(ctx, b2, last)!.book.why ?? ""));
const moves2 = mv.filter((m) => m.flock_internal_id === b2 && m.date <= "2026-08-31" && ["transfer_in", "transfer_out"].includes(m.movement_type)).reduce((s, m) => s + m.birds_change, 0);
ok("BAB-2: birds moved in (9, 13 and 17 Aug) raise the number housed from those days", housedOn(ctx, h2, "2026-08-31") === h2.count + moves2 && moves2 === 709 + 1080 + 800, `${housedOn(ctx, h2, "2026-08-31")}`);
const ob1 = idOf("Old BAB-1 (sold Sep)");
const hob1 = hensHoused(ctx, ob1)!;
ok("Old BAB-1: the two sales (5,218 and 3,181 birds) do NOT change the number housed (sales are losses hen-housed shows)", housedOn(ctx, hob1, "2026-09-09") === hob1.count + 30, `${housedOn(ctx, hob1, "2026-09-09")} = ${hob1.count} + 30 moved in`);

// ---- every flock: with no birds moved in, hen-housed % is never above hen-day % ----
let above = 0;
for (const id of ctx.flockById.keys()) {
  const h = flockHenHoused(ctx, id, last);
  if (!h?.last7 || h.last7.hhPct == null || h.last7.hdPct == null) continue;
  const movedIn = mv.some((m) => m.flock_internal_id === id && m.birds_change > 0 && ["transfer_in", "unexplained_in"].includes(m.movement_type) && m.date >= h.last7!.from);
  if (!movedIn && h.last7.hhPct > h.last7.hdPct + 1e-9) above++;
}
ok("no flock shows hen-housed % above hen-day % over its last 7 days", above === 0, `${above} above`);

// ---- the period engine and the group tile ----
const s9 = summarizeRange(ctx, cost, extras, makeRange("2026-11-13", "2026-11-19"), { flocks: [b9] });
const r9w = henHousedFor(ctx, b9, "2026-11-19", "2026-11-13");
near("per-flock table (period engine), BAB-9 13-19 Nov = henHousedFor over the same days", s9.flocks[0]?.henHousedPct, r9w?.hhPct ?? null);
ok("per-flock table carries the source and the book", s9.flocks[0]?.housedSource === "register" && s9.flocks[0]?.bookHenHousedPct != null);
const young = flocks.filter((f) => f.segment === "young").map((f) => f.flock_internal_id as string);
const g = groupHenHoused(ctx, young, "2026-11-13", "2026-11-19");
const gEggs = dp.filter((r) => young.includes(r.flock_internal_id) && r.date >= "2026-11-13" && r.date <= "2026-11-19").reduce((s, r) => s + (r.eggs_total ?? 0), 0);
const gHenDays = young.reduce((s, id) => { const h = hensHoused(ctx, id)!; return s + dp.filter((r) => r.flock_internal_id === id && r.date >= "2026-11-13" && r.date <= "2026-11-19").reduce((t, r) => t + housedOn(ctx, h, r.date), 0); }, 0);
near("young group tile 13-19 Nov = all their eggs ÷ the sum of each day's hens housed", g.hhPct, (gEggs / gHenDays) * 100);
ok("young group: no stand-ins", g.standins.length === 0 && g.flocks === 3);

// ---- Compare ----
const A = compareSide(ctx, cost, extras, { key: "a", flockId: b9, flockLabel: "BAB-9", range: makeRange("2026-11-13", "2026-11-19"), notes: [] });
const B = compareSide(ctx, cost, extras, { key: "b", flockId: null, flockLabel: "All flocks", range: makeRange("2026-11-13", "2026-11-19"), notes: [] });
const rows = compareRows(A, B);
const hh = rows.find((r) => r.key === "hhPct")!;
ok("Compare: hen-housed % for a single flock, 'per flock only' for All flocks", hh.a != null && Math.abs((hh.a as number) - r9w!.hhPct!) < 1e-9 && hh.b === null && /per flock only/.test(hh.bNote ?? ""));

// ---- the owner's own number replaces the register / stand-in ----
OWNER_HENS_HOUSED[b2] = { count: 10000, date: "2026-07-02" };
const own = hensHoused(ctx, b2)!;
ok("an owner-given number is used as is (source 'owner') and gets the book comparison", own.source === "owner" && own.count === 10000 && henHousedFor(ctx, b2, last)!.book.why !== "the number housed is not known (stand-in), so it is not compared with the book");
delete OWNER_HENS_HOUSED[b2];

process.exit(bad ? 1 : 0);
