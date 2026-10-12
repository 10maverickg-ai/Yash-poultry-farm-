import { digitSubstitutionCandidates } from "./digitEvidence";

// Generic single-digit-repair search (owner request, 2026-10-19, extending
// extraction to the egg stock ledger and feed bag box): "find whether
// exactly ONE single-digit change to ONE read value ... repairs every
// failing check at once ... If zero or several candidates fit, do not
// guess." Shared by eggLedgerResolve.ts and feedBoxResolve.ts — both are
// just a different set of named fields and a different set of arithmetic
// checks over the SAME underlying search, so the search itself is written
// once, here, instead of twice.
//
// The search space is deliberately restricted to the fields the caller
// passes in — never a field on a different table or a different day's row.
// Both call sites pass ONLY this ledger/box's OWN fields for THIS date, so a
// cross-table disagreement (production vs. flock eggs sum, consumed vs.
// flock feed_bags sum) or a previous-day mismatch can only ever be
// "repaired" by changing one of THIS row's own numbers — exactly the
// owner's rule: never change Daily Production from here, never touch the
// previous day's row. If the true fix lives on the other side, no
// candidate here will satisfy every check, and the search correctly
// reports "no repair found".

export interface RepairField {
  name: string;
  value: number | null;
}

export interface RepairResult {
  field: string;
  from: number;
  to: number;
}

// A check takes the full set of current field values (by name) and reports
// whether it currently holds. `true` also for a check that doesn't apply
// (e.g. no previous day to compare against) — callers simply omit a
// not-applicable check from the list rather than encode "N/A" here.
export type RepairCheck = (values: Record<string, number | null>) => boolean;

/**
 * Returns the unique single-digit-substitution fix that makes every check
 * pass, or null if no fix is needed (everything already passes), no single
 * field's substitution fixes everything, or more than one field's
 * substitution would — ambiguous cases are never guessed.
 */
export function findSingleDigitRepair(
  fields: RepairField[],
  checks: RepairCheck[]
): RepairResult | null {
  const current: Record<string, number | null> = {};
  for (const f of fields) current[f.name] = f.value;

  if (checks.every((c) => c(current))) return null; // nothing failing

  const candidates: RepairResult[] = [];
  for (const f of fields) {
    if (f.value === null) continue;
    for (const to of digitSubstitutionCandidates(f.value)) {
      if (to < 0) continue;
      const trial = { ...current, [f.name]: to };
      if (checks.every((c) => c(trial))) {
        candidates.push({ field: f.name, from: f.value, to });
      }
    }
  }

  return candidates.length === 1 ? candidates[0] : null;
}
