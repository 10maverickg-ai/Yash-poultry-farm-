// Tests stdFor()/breedKey(): every flock is compared only with ITS OWN breed's standard.
//   node scripts/std-for-check.mts
import { buildCtx, stdFor, breedKey, breedName, type EngineInput, type FlockRef } from "../lib/analytics/engine.ts";

let failed = 0;
const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
};
const has = (name: string, text: string, part: string) => {
  const ok = text.includes(part);
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n   "${text}" lacks "${part}"`}`);
};

const base = (extra: Partial<EngineInput> = {}): EngineInput => ({
  flocks: [], prod: [], movements: [], egg: [], feedBoxes: [], chick: [], farmfreshDates: [], moulting: [],
  std: [{ age: 40, hdp: 96.9 }, { age: 41, hdp: 96.5 }, { age: 100, hdp: 75.3 }],
  ...extra,
});
const flock = (breed: string | null, placement = "2025-12-01", confirmed = true): FlockRef => ({ id: "f", label: "BAB-X", breed, placementDate: placement, placementConfirmed: confirmed });
const asOf = "2026-09-07"; // 2025-12-01 + 40 weeks exactly (280 days)
const ctx = buildCtx(base());

eq("breedKey: BV300 spellings", [breedKey("BV300"), breedKey("bv 300"), breedKey("BV-300 (2023)")], ["BV300", "BV300", "BV300"]);
eq("breedKey: Bovans spellings all mean Bovans White", [breedKey("Bowan"), breedKey("Bovans"), breedKey("Bovans White"), breedKey("BOVANS-WHITE")], ["BOVANS_WHITE", "BOVANS_WHITE", "BOVANS_WHITE", "BOVANS_WHITE"]);
eq("breedKey: empty", [breedKey(null), breedKey("  ")], [null, null]);
eq("breedName: Bowan shows as Bovans White", breedName("Bowan"), "Bovans White");

eq("BV300 at week 40 (in range) → table value", stdFor(ctx, flock("BV300"), asOf).std, 96.9);
const w100 = stdFor(ctx, flock("BV300", "2024-10-06"), asOf); // 2024-10-06 → 2026-09-07 = 100 weeks
eq("BV300 at week 100 (last row) → 75.3", [w100.age, w100.std], [100, 75.3]);
const old = stdFor(ctx, flock("BV300", "2024-06-20"), asOf);
eq("BV300 past week 100 → no std", old.std, null);
has("  …says no reference loaded and the covered weeks", old.why, "no reference loaded (age 11");
has("  …names the table range", old.why, "weeks 40–100");
const young = stdFor(ctx, flock("BV300", "2026-06-01"), asOf);
eq("BV300 under the table's first week → no std", young.std, null);

const bov = stdFor(ctx, flock("Bowan"), asOf);
eq("Bowan WITHOUT a loaded table → no std (never BV300's)", bov.std, null);
has("  …says 'no reference loaded for Bovans White'", bov.why, "no reference loaded for Bovans White");

const ctxB = buildCtx(base({ stdByBreed: { BOVANS_WHITE: [{ age: 40, hdp: 94.1 }, { age: 41, hdp: 93.8 }] } }));
eq("Bowan WITH a loaded table → its own value, not BV300's", stdFor(ctxB, flock("Bowan"), asOf).std, 94.1);
eq("BV300 flock still uses BV300 when a Bovans table exists", stdFor(ctxB, flock("BV300"), asOf).std, 96.9);
const bovOut = stdFor(ctxB, flock("Bovans White", "2025-06-01"), asOf);
eq("Bovans week outside its table → no std", bovOut.std, null);
has("  …says weeks covered by the Bovans table", bovOut.why, "Bovans White table covers weeks 40–41");

eq("unknown breed without table → no std", stdFor(ctx, flock("Hy-Line Brown"), asOf).std, null);
eq("no breed text → no std", stdFor(ctx, flock(null), asOf).std, null);
const ph = stdFor(ctx, flock("BV300", "2026-01-01", false), asOf);
eq("placeholder placement date → age unknown, no standard", [ph.std, ph.age], [null, null]);
has("  …explains it", ph.why, "age unknown, no standard check");
eq("no placement date → age unknown", stdFor(ctx, { ...flock("BV300"), placementDate: null }, asOf).std, null);
process.exit(failed ? 1 : 0);
