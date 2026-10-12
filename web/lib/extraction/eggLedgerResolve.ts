import { findSingleDigitRepair, type RepairField, type RepairCheck } from "./digitRepair";
import type { EntryCategory } from "../eggstock-types";

// Egg stock ledger resolution (owner request, 2026-10-19): the five checks
// from the owner's spec, run per section (small/big), with the same
// single-digit-repair-or-flag philosophy as every other correction in this
// codebase. Pure — no database — so every real worked example can be
// exercised directly (see scripts/regression-egg-ledger-feed-box.ts).
//
// Sign convention: everything here works in the register's own POSITIVE
// terms (opening, production, total line, closing, and every deduction's
// magnitude) — amount_eggs is stored SIGNED (deductions negative) in
// daily_egg_stock_entries by an existing, pre-this-PR convention this
// module doesn't change; negating a deduction's magnitude into that signed
// column is the caller's job at the DB-write boundary, not this module's.
// digitSubstitutionCandidates (digitRepair.ts -> digitEvidence.ts) only
// ever returns POSITIVE candidates, so working in magnitudes throughout is
// also what makes the repair search itself correct.

export interface RawEggLedgerDeduction {
  labelAsWritten: string;
  amountEggs: number; // positive magnitude, as written
  categoryGuess: EntryCategory | null;
  confidence: number;
}

export interface RawEggLedgerSection {
  section: "small" | "big";
  openingBalanceEggs: number | null;
  // The register's "(+)" production figure for the day.
  totalEggsProduced: number | null;
  totalLineEggs: number | null;
  deductions: RawEggLedgerDeduction[];
  closingBalanceEggs: number | null;
}

export interface EggLedgerContext {
  // Sum of eggs_total for the flocks linked to this section on this date,
  // or null if there's nothing to compare against yet (no flocks linked,
  // or no Daily Production rows for the date).
  flockEggsSum: number | null;
  // The previous day's closing balance for the SAME section, or null if
  // there's no previous day saved.
  previousClosingBalanceEggs: number | null;
}

export interface ResolvedEggLedgerDeduction {
  labelAsWritten: string;
  amountEggs: number;
  amountEggsOriginal: number | null;
  categoryGuess: EntryCategory | null;
  confidence: number;
}

export interface ResolvedEggLedgerSection {
  section: "small" | "big";
  openingBalanceEggs: number | null;
  openingBalanceEggsOriginal: number | null;
  totalEggsProduced: number | null;
  totalEggsProducedOriginal: number | null;
  totalLineEggs: number | null;
  totalLineEggsOriginal: number | null;
  closingBalanceEggs: number | null;
  closingBalanceEggsOriginal: number | null;
  deductions: ResolvedEggLedgerDeduction[];
  // Informational only, same "<original> corrected to <current>: <reasoning>"
  // marker convention used throughout this codebase. Null unless a repair
  // was applied. Whether the (possibly still-wrong) result ends up flagged
  // is decided by fn_validate_egg_stock_summary after this is saved, not
  // here — see pipeline.ts's analogous split for Daily Production.
  autoCorrectionNote: string | null;
}

const DB_FIELD_NAME: Record<string, string> = {
  opening: "opening_balance_eggs",
  production: "total_eggs_produced",
  totalLine: "total_line_eggs",
  closing: "closing_balance_eggs",
};

export function resolveEggLedgerSection(
  raw: RawEggLedgerSection,
  context: EggLedgerContext
): ResolvedEggLedgerSection {
  const fields: RepairField[] = [
    { name: "opening", value: raw.openingBalanceEggs },
    { name: "production", value: raw.totalEggsProduced },
    { name: "totalLine", value: raw.totalLineEggs },
    { name: "closing", value: raw.closingBalanceEggs },
    ...raw.deductions.map((d, i) => ({ name: `deduction_${i}`, value: d.amountEggs })),
  ];

  const checks: RepairCheck[] = [];

  // Check 1: every quantity is a multiple of 30 (eggs only ever move in
  // whole trays — owner-confirmed, same rule as Daily Production's eggs).
  checks.push((v) =>
    fields.every((f) => {
      const val = v[f.name];
      return val === null || val % 30 === 0;
    })
  );

  // Check 2: opening + production = total line.
  if (raw.openingBalanceEggs !== null && raw.totalEggsProduced !== null && raw.totalLineEggs !== null) {
    checks.push((v) => (v.opening as number) + (v.production as number) === v.totalLine);
  }

  // Check 3: total line − sum(deductions) = closing.
  if (raw.totalLineEggs !== null && raw.closingBalanceEggs !== null) {
    checks.push((v) => {
      const deductionSum = raw.deductions.reduce((sum, _, i) => sum + ((v[`deduction_${i}`] as number) ?? 0), 0);
      return (v.totalLine as number) - deductionSum === v.closing;
    });
  }

  // Check 4: production equals the linked flocks' own eggs_total sum.
  // flockEggsSum is a fixed comparison target, never itself a candidate —
  // this can only ever be "repaired" by changing THIS ledger's own
  // production figure, never Daily Production (owner's explicit rule).
  if (context.flockEggsSum !== null && raw.totalEggsProduced !== null) {
    checks.push((v) => v.production === context.flockEggsSum);
  }

  // Check 5: opening equals the previous day's closing for the SAME
  // section. previousClosingBalanceEggs is likewise fixed — this can only
  // ever be "repaired" by changing THIS day's opening, never yesterday's
  // row (owner's explicit rule).
  if (context.previousClosingBalanceEggs !== null && raw.openingBalanceEggs !== null) {
    checks.push((v) => v.opening === context.previousClosingBalanceEggs);
  }

  const repair = findSingleDigitRepair(fields, checks);

  let openingBalanceEggs = raw.openingBalanceEggs;
  let openingBalanceEggsOriginal: number | null = null;
  let totalEggsProduced = raw.totalEggsProduced;
  let totalEggsProducedOriginal: number | null = null;
  let totalLineEggs = raw.totalLineEggs;
  let totalLineEggsOriginal: number | null = null;
  let closingBalanceEggs = raw.closingBalanceEggs;
  let closingBalanceEggsOriginal: number | null = null;
  const deductions: ResolvedEggLedgerDeduction[] = raw.deductions.map((d) => ({
    labelAsWritten: d.labelAsWritten,
    amountEggs: d.amountEggs,
    amountEggsOriginal: null,
    categoryGuess: d.categoryGuess,
    confidence: d.confidence,
  }));
  let autoCorrectionNote: string | null = null;

  if (repair) {
    const reasoning = `the only single-digit change that makes the ${raw.section} ledger's own arithmetic balance exactly, while keeping every figure a multiple of 30`;
    if (repair.field === "opening") {
      openingBalanceEggsOriginal = repair.from;
      openingBalanceEggs = repair.to;
    } else if (repair.field === "production") {
      totalEggsProducedOriginal = repair.from;
      totalEggsProduced = repair.to;
    } else if (repair.field === "totalLine") {
      totalLineEggsOriginal = repair.from;
      totalLineEggs = repair.to;
    } else if (repair.field === "closing") {
      closingBalanceEggsOriginal = repair.from;
      closingBalanceEggs = repair.to;
    } else if (repair.field.startsWith("deduction_")) {
      const idx = Number(repair.field.slice("deduction_".length));
      deductions[idx] = { ...deductions[idx], amountEggsOriginal: repair.from, amountEggs: repair.to };
    }
    const label = repair.field.startsWith("deduction_")
      ? `"${deductions[Number(repair.field.slice("deduction_".length))].labelAsWritten}" amount`
      : DB_FIELD_NAME[repair.field];
    autoCorrectionNote = `${label} ${repair.from} corrected to ${repair.to}: ${reasoning}.`;
  }

  return {
    section: raw.section,
    openingBalanceEggs,
    openingBalanceEggsOriginal,
    totalEggsProduced,
    totalEggsProducedOriginal,
    totalLineEggs,
    totalLineEggsOriginal,
    closingBalanceEggs,
    closingBalanceEggsOriginal,
    deductions,
    autoCorrectionNote,
  };
}
