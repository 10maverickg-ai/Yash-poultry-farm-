import type { ExtractedFlockRow } from "../dailyProduction";
import { BAL_BIRD_TOLERANCE, looksLikeGenuineSubtotal, type Section, type SectionSubtotal } from "../pageChecksum";
import { calcHd, hdWithinTolerance } from "../digitEvidence";
import { findSingleDigitRepair, type RepairCheck, type RepairField } from "../digitRepair";
import { resolveEggLedgerSection } from "../eggLedgerResolve";
import { resolveFeedBox } from "../feedBoxResolve";
import { checkMortalitySectionChecksums } from "../mortalityChecksum";
import { checkBalBirdChain } from "../balBirdChain";
import { checkWrittenHdDigitAccuracy, WRITTEN_HD_CLEAN_TOLERANCE } from "../writtenHdCheck";
import { normalizeFlockLabel } from "../flockMatch";
import type { EggStockSection } from "../../eggstock-types";
import type { NormalizedBox } from "./types";
import type { HalfSide, HalfFlockRow, PageHalfExtraction } from "./pageHalfRegion";
import type { ExtractedEggLedgerRegion } from "./ledgerRegion";
import type { ExtractedFeedBoxRegion, FeedBoxGroupLabel } from "./feedBoxRegion";
import { extractDailyProductionRegion, type DailyProductionRegionResult } from "./dailyProductionRegion";
import { extractEggLedgerByLines } from "./ledgerRegion";
import { extractFeedBoxRegion } from "./feedBoxRegion";
import { recropForRetry } from "./crop";
import { assignTableSections, assignLedgerSections, collectFeedBoxes, type HalfResult } from "./contentMapping";

// Correction stages for the new reader (owner request, 2026-10-21): the
// raw half-page reads are run through the staged correction code the repo
// already has (digitEvidence, digitRepair, eggLedgerResolve, feedBoxResolve,
// mortalityChecksum, balBirdChain, writtenHdCheck) and the benchmark scores
// BOTH the raw and the corrected result.
//
// One rule decides what happens to any item whose own checks fail:
//   1. exactly ONE single-digit change that makes every failing check pass
//      (and breaks none that held) -> applied automatically ("repaired");
//   2. otherwise a ZOOMED re-read of just that region, up to
//      MAX_REREAD_ROUNDS times, re-running the repair after each ("reread");
//   3. otherwise the item is saved as "needs review", naming the checks
//      that still fail — never silently presented as a clean reading.
//
// Everything here is pure except the three re-read calls, which are
// injected (CorrectionDeps) so the whole flow can be exercised with fakes
// (scripts/regression-correction-stages.ts).

export const MAX_REREAD_ROUNDS = 3;

export type CellStatus = "repaired" | "reread" | "needs_review";

export interface CellOutcome {
  item: string; // "BAB-2", "subtotal main", "big ledger", "BAB-1-7 feed box"
  field: string;
  status: CellStatus;
  from: number | null;
  to: number | null;
  note: string;
}

export interface CorrectionDeps {
  rereadSection(
    image: { base64: string; mediaType: "image/jpeg" },
    section: Section,
    box: NormalizedBox,
    hint: string
  ): Promise<DailyProductionRegionResult>;
  rereadLedger(
    image: { base64: string; mediaType: "image/jpeg" },
    section: EggStockSection,
    box: NormalizedBox,
    hint: string
  ): Promise<ExtractedEggLedgerRegion>;
  rereadFeedBox(
    image: { base64: string; mediaType: "image/jpeg" },
    group: FeedBoxGroupLabel,
    box: NormalizedBox,
    hint: string
  ): Promise<ExtractedFeedBoxRegion>;
}

export const liveCorrectionDeps: CorrectionDeps = {
  async rereadSection(image, section, box, hint) {
    const z = await recropForRetry(image.base64, box, 1800);
    return extractDailyProductionRegion(z.base64, z.mediaType, section, { confusionHint: hint });
  },
  async rereadLedger(image, section, box, hint) {
    const z = await recropForRetry(image.base64, box, 2000);
    return extractEggLedgerByLines(z.base64, z.mediaType, section, { confusionHint: hint });
  },
  async rereadFeedBox(image, group, box, hint) {
    const z = await recropForRetry(image.base64, box, 1800);
    return extractFeedBoxRegion(z.base64, z.mediaType, group, { confusionHint: hint });
  },
};

// A zoomed re-read that errors (cut-off response, no structured result)
// must never abort the whole run: it counts as "no new reading".
async function softly<T>(rec: { warnings: string[] }, what: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    // Billing / auth failures are not "no new reading" — they invalidate the
    // whole run, so they must stop it rather than be swallowed.
    const status = (err as { status?: number }).status;
    const msg = err instanceof Error ? err.message : String(err);
    if (status === 401 || status === 402 || status === 403 || /credit balance|invalid x-api-key|authentication/i.test(msg)) throw err;
    rec.warnings.push(`${what}: zoomed re-read failed (${err instanceof Error ? err.message : String(err)}) — kept the previous reading.`);
    return null;
  }
}

const CONFUSIONS = "3↔8, 1↔7, 1↔4, 9↔0, 5↔6, 2↔7, 9↔4";

// ===================================================================
// Raw page assembly (no corrections at all)
// ===================================================================

export interface CorrFlock extends ExtractedFlockRow {
  rowBox: NormalizedBox; // relative to the half image named by `side`
  side: HalfSide;
  ambiguousDigits: string | null;
}

export interface PageState {
  flocks: CorrFlock[];
  subtotals: Record<Section, SectionSubtotal | null>;
  // Ledgers and feed boxes as read (or, after correction, as corrected).
  ledgers: Map<EggStockSection, { side: HalfSide; ledger: ExtractedEggLedgerRegion }>;
  feedBoxes: FeedBoxEntry[];
  tableSide: Map<Section, HalfSide>;
}

export interface FeedBoxEntry {
  group: FeedBoxGroupLabel;
  side: HalfSide;
  index: number; // left-to-right position among the boxes found
  box: ExtractedFeedBoxRegion;
  assignedBy: "as_read" | "consumed_matches_flock_feed" | "position" | "model_label";
}

function toCorrFlock(f: HalfFlockRow, section: Section, side: HalfSide): CorrFlock {
  return {
    display_label_as_written: f.display_label_as_written,
    section,
    mortality: f.mortality,
    feed_bags: f.feed_bags,
    eggs_total: f.eggs_total,
    eggs_ii: f.eggs_ii,
    bird_population: f.bird_population,
    bird_population_readings: Array.isArray(f.bird_population_readings) ? f.bird_population_readings : [],
    hd_percent: f.hd_percent,
    margin_note: f.margin_note,
    confidence: f.confidence,
    rowBox: f.row_box,
    side,
    ambiguousDigits: f.ambiguous_digits,
  };
}

export function buildRawPage(halves: HalfResult[]): PageState {
  const sectionBySide = assignTableSections(halves);
  const flocks: CorrFlock[] = [];
  const subtotals: Record<Section, SectionSubtotal | null> = { main: null, continuation: null };
  const tableSide = new Map<Section, HalfSide>();
  for (const h of halves) {
    const section = sectionBySide.get(h.side);
    const table = h.extraction.table;
    if (!section || !table) continue;
    tableSide.set(section, h.side);
    if (table.subtotal) subtotals[section] = { section, ...table.subtotal };
    for (const f of table.flocks) flocks.push(toCorrFlock(f, section, h.side));
  }
  const ledgers = assignLedgerSections(halves, sectionBySide);
  const feedBoxes: FeedBoxEntry[] = collectFeedBoxes(halves).map((f, index) => ({
    group: f.box.coverage,
    side: f.side,
    index,
    box: f.box,
    assignedBy: "as_read" as const,
  }));
  return { flocks, subtotals, ledgers, feedBoxes, tableSide };
}

export function clonePage(p: PageState): PageState {
  return {
    flocks: p.flocks.map((f) => ({ ...f, confidence: { ...f.confidence } })),
    subtotals: { main: p.subtotals.main ? { ...p.subtotals.main } : null, continuation: p.subtotals.continuation ? { ...p.subtotals.continuation } : null },
    ledgers: new Map([...p.ledgers].map(([k, v]) => [k, { side: v.side, ledger: { ...v.ledger, deductions: v.ledger.deductions.map((d) => ({ ...d })) } }])),
    feedBoxes: p.feedBoxes.map((b) => ({ ...b, box: { ...b.box } })),
    tableSide: new Map(p.tableSide),
  };
}

// ===================================================================
// Context from saved data of OTHER days (read-only)
// ===================================================================

export interface CorrectionContext {
  // Previous calendar day's bal bird per flock (normalized label), only
  // when that day is exactly the day before — null disables the chain.
  prevBird: Map<string, number> | null;
  prevLedgerClosing: Partial<Record<EggStockSection, number | null>>;
  prevFeedClosing: Partial<Record<FeedBoxGroupLabel, number | null>>;
  images: Record<HalfSide, { base64: string; mediaType: "image/jpeg" }>;
}

export interface CorrectionReport {
  outcomes: CellOutcome[];
  rereadCalls: number;
  warnings: string[];
  // Plain-language lines for the page: what was done and why.
  log: string[];
}

class Recorder {
  outcomes: CellOutcome[] = [];
  rereadCalls = 0;
  warnings: string[] = [];
  log: string[] = [];
  add(o: CellOutcome) {
    this.outcomes.push(o);
    this.log.push(`${o.item} ${o.field}: ${o.status.replace("_", " ")} — ${o.note}`);
  }
}

// ===================================================================
// Flock tables
// ===================================================================

type FlockField = "mortality" | "feed_bags" | "eggs_total" | "bird_population" | "hd_percent";

interface Failure {
  kind: "missing" | "eggs30" | "hd" | "sum_eggs" | "sum_mortality" | "sum_feed" | "sum_bird" | "sum_hd" | "chain" | "subtotal_missing";
  section: Section;
  label: string | null; // null = section-level
  message: string;
  fields?: FlockField[]; // overrides IMPLICATED[kind] (missing cells)
}

function inSection(p: PageState, s: Section) {
  return p.flocks.filter((f) => f.section === s);
}

function trustedSubtotal(p: PageState, s: Section): SectionSubtotal | null {
  const sub = p.subtotals[s];
  return sub && looksLikeGenuineSubtotal(sub) ? sub : null;
}

function hdGap(f: CorrFlock): number | null {
  if (f.eggs_total === null || f.bird_population === null || f.hd_percent === null) return null;
  const calc = calcHd(f.eggs_total, f.bird_population);
  return calc === null ? null : Math.abs(calc - f.hd_percent);
}

// The handwriting often renders the "B" of "BAB" as "13", which the model
// then reports as "BAB-13-1" or "13AB-1"; the flock number is always the
// LAST number in the label.
export function flockNumber(label: string): number | null {
  const nums = normalizeFlockLabel(label).match(/\d+/g);
  return nums ? parseInt(nums[nums.length - 1], 10) : null;
}

function prevBirdFor(ctx: CorrectionContext, label: string): number | null {
  const n = flockNumber(label);
  if (n === null || !ctx.prevBird) return null;
  return ctx.prevBird.get(`BAB-${n}`) ?? null;
}

function flockFailures(p: PageState, ctx: CorrectionContext): Failure[] {
  const out: Failure[] = [];
  for (const f of p.flocks) {
    const missing = (["mortality", "feed_bags", "eggs_total", "bird_population", "hd_percent"] as const).filter((k) => f[k] === null);
    if (missing.length > 0) {
      out.push({ kind: "missing", section: f.section, label: f.display_label_as_written, message: `${missing.join(", ")} not read`, fields: missing });
    }
    if (f.eggs_total !== null && f.eggs_total % 30 !== 0) {
      out.push({ kind: "eggs30", section: f.section, label: f.display_label_as_written, message: `eggs ${f.eggs_total} is not a multiple of 30` });
    }
    const gap = hdGap(f);
    if (gap !== null && gap > WRITTEN_HD_CLEAN_TOLERANCE) {
      out.push({ kind: "hd", section: f.section, label: f.display_label_as_written, message: `written HD ${f.hd_percent} vs ${f.eggs_total}/${f.bird_population} = ${(calcHd(f.eggs_total as number, f.bird_population as number) as number).toFixed(2)}` });
    }
    const prev = prevBirdFor(ctx, f.display_label_as_written);
    if (prev !== null) {
      const chain = checkBalBirdChain({
        eggsTotal: f.eggs_total,
        todayMortality: f.mortality,
        todayExtractedBalBird: f.bird_population,
        todayWrittenHd: f.hd_percent,
        previousBalBird: prev,
      });
      if (chain.kind === "flag_today") {
        out.push({ kind: "chain", section: f.section, label: f.display_label_as_written, message: chain.note });
      }
    }
  }
  for (const s of ["main", "continuation"] as const) {
    const flocks = inSection(p, s);
    if (flocks.length === 0) continue;
    const sub = trustedSubtotal(p, s);
    if (!sub) {
      out.push({ kind: "subtotal_missing", section: s, label: null, message: `the ${s} table's subtotal row was not read (no Bal Bird / % alongside it)` });
      continue;
    }
    const sum = (k: FlockField) => flocks.reduce((t, f) => t + (f[k] ?? 0), 0);
    if (sub.eggs !== null && sum("eggs_total") !== sub.eggs) out.push({ kind: "sum_eggs", section: s, label: null, message: `${s}: flock eggs sum to ${sum("eggs_total")}, subtotal reads ${sub.eggs}` });
    if (sub.mortality !== null && sum("mortality") !== sub.mortality) out.push({ kind: "sum_mortality", section: s, label: null, message: `${s}: flock mortality sums to ${sum("mortality")}, subtotal reads ${sub.mortality}` });
    if (sub.feed_bags !== null && sum("feed_bags") !== sub.feed_bags) out.push({ kind: "sum_feed", section: s, label: null, message: `${s}: flock feed sums to ${sum("feed_bags")}, subtotal reads ${sub.feed_bags}` });
    if (sub.bal_bird !== null && Math.abs(sum("bird_population") - sub.bal_bird) > BAL_BIRD_TOLERANCE) out.push({ kind: "sum_bird", section: s, label: null, message: `${s}: flock bal birds sum to ${sum("bird_population")}, subtotal reads ${sub.bal_bird}` });
    if (sub.hd_percent !== null && sum("eggs_total") > 0 && sum("bird_population") > 0) {
      const calc = calcHd(sum("eggs_total"), sum("bird_population")) as number;
      if (Math.abs(calc - sub.hd_percent) > 0.5) out.push({ kind: "sum_hd", section: s, label: null, message: `${s}: subtotal % reads ${sub.hd_percent}, flock sums imply ${calc.toFixed(2)}` });
    }
  }
  return out;
}

function setFlockField(f: CorrFlock, field: FlockField, v: number) {
  f[field] = v;
}

// Stage: mortality section checksum (existing module).
function stageMortalityChecksum(p: PageState, ctx: CorrectionContext, rec: Recorder) {
  const subs = (["main", "continuation"] as const).map((s) => p.subtotals[s]).filter((s): s is SectionSubtotal => s !== null);
  const result = checkMortalitySectionChecksums(
    p.flocks.map((f) => {
      const prev = prevBirdFor(ctx, f.display_label_as_written);
      return {
        label: f.display_label_as_written,
        section: f.section,
        mortality: f.mortality,
        chainImpliedMortality: prev !== null && f.bird_population !== null ? prev - f.bird_population : null,
      };
    }),
    subs
  );
  for (const c of result.corrections) {
    const f = p.flocks.find((x) => x.display_label_as_written === c.label);
    if (!f) continue;
    f.mortality = c.to;
    rec.add({ item: c.label, field: "mortality", status: "repaired", from: c.from, to: c.to, note: c.note });
  }
}

// Stage: bal-bird day-to-day chain (existing module) — only its
// auto_correct verdict (HD-corroborated) is ever applied.
function stageChain(p: PageState, ctx: CorrectionContext, rec: Recorder) {
  for (const f of p.flocks) {
    const prev = prevBirdFor(ctx, f.display_label_as_written);
    if (prev === null) continue;
    const r = checkBalBirdChain({
      eggsTotal: f.eggs_total,
      todayMortality: f.mortality,
      todayExtractedBalBird: f.bird_population,
      todayWrittenHd: f.hd_percent,
      previousBalBird: prev,
    });
    if (r.kind === "auto_correct") {
      rec.add({ item: f.display_label_as_written, field: "bird_population", status: "repaired", from: f.bird_population, to: r.correctedBalBird, note: r.note });
      f.bird_population = r.correctedBalBird;
    }
  }
}

// Stage: unique single-digit change (digitRepair.ts). For each flock in
// turn (and for the subtotal row), the search asks: is there exactly ONE
// single-digit change to one of THAT row's cells that makes every check
// touching that row pass — its own eggs-multiple-of-30 and HD checks plus
// the section's subtotal sums? Checks that belong to OTHER rows are not
// held against it, so two unrelated misreads on one page are repaired
// independently; but if two different rows could each close the same
// failing check, nothing is applied (ambiguous — never guess).
function stageSectionRepair(p: PageState, s: Section, rec: Recorder) {
  const flocks = inSection(p, s);
  const sub = trustedSubtotal(p, s);
  if (flocks.length === 0 || !sub) return;

  const current: Record<string, number | null> = {};
  for (const f of flocks) {
    const l = f.display_label_as_written;
    current[`${l}|mortality`] = f.mortality;
    current[`${l}|feed_bags`] = f.feed_bags;
    current[`${l}|eggs_total`] = f.eggs_total;
    current[`${l}|bird_population`] = f.bird_population;
  }
  current["sub|eggs"] = sub.eggs;
  current["sub|mortality"] = sub.mortality;
  current["sub|feed_bags"] = sub.feed_bags;

  interface NamedCheck { id: string; fn: RepairCheck }
  const sumChecks: NamedCheck[] = [];
  for (const [key, subKey] of [["eggs_total", "eggs"], ["mortality", "mortality"], ["feed_bags", "feed_bags"]] as const) {
    if (sub[subKey] === null) continue;
    sumChecks.push({ id: `sum:${key}`, fn: (v) => flocks.reduce((t, f) => t + ((v[`${f.display_label_as_written}|${key}`] as number | null) ?? 0), 0) === v[`sub|${subKey}`] });
  }
  const ownChecks = (f: CorrFlock): NamedCheck[] => {
    const l = f.display_label_as_written;
    const out: NamedCheck[] = [{ id: `eggs30:${l}`, fn: (v) => v[`${l}|eggs_total`] === null || (v[`${l}|eggs_total`] as number) % 30 === 0 }];
    if (f.hd_percent !== null) {
      out.push({
        id: `hd:${l}`,
        fn: (v) => {
          const e = v[`${l}|eggs_total`];
          const b = v[`${l}|bird_population`];
          if (e === null || b === null) return true;
          const calc = calcHd(e, b);
          return calc === null || hdWithinTolerance(calc, f.hd_percent as number, WRITTEN_HD_CLEAN_TOLERANCE);
        },
      });
    }
    return out;
  };

  const found: { item: string; field: string; from: number; to: number; fixed: string[] }[] = [];
  const targets: { item: string; fieldNames: string[]; checks: NamedCheck[] }[] = flocks.map((f) => {
    const l = f.display_label_as_written;
    return { item: l, fieldNames: ["mortality", "feed_bags", "eggs_total", "bird_population"].map((k) => `${l}|${k}`), checks: [...sumChecks, ...ownChecks(f)] };
  });
  targets.push({ item: "sub", fieldNames: ["sub|eggs", "sub|mortality", "sub|feed_bags"], checks: sumChecks });

  for (const t of targets) {
    const fields: RepairField[] = t.fieldNames.map((name) => ({ name, value: current[name] }));
    // findSingleDigitRepair only knows this row's cells; every check also
    // needs the rest of the page's values, held fixed.
    const repair = findSingleDigitRepair(fields, t.checks.map((c): RepairCheck => (v) => c.fn({ ...current, ...v })));
    if (!repair) continue;
    const trial = { ...current, [repair.field]: repair.to };
    const fixed = t.checks.filter((c) => !c.fn(current) && c.fn(trial)).map((c) => c.id);
    found.push({ item: t.item, field: repair.field, from: repair.from, to: repair.to, fixed });
  }

  // Two rows that could close the same failing check = ambiguous.
  const claims = new Map<string, number>();
  for (const r of found) for (const id of r.fixed) claims.set(id, (claims.get(id) ?? 0) + 1);
  for (const r of found) {
    if (r.fixed.some((id) => (claims.get(id) ?? 0) > 1)) continue;
    const field = r.field.split("|")[1];
    const note = `the only single-digit change to this row that makes every failing ${s}-table check it is part of pass (${r.fixed.join(", ")})`;
    if (r.item === "sub") {
      (sub as SectionSubtotal)[field as "eggs" | "mortality" | "feed_bags"] = r.to;
      rec.add({ item: `subtotal ${s}`, field, status: "repaired", from: r.from, to: r.to, note });
    } else {
      const f = flocks.find((x) => x.display_label_as_written === r.item)!;
      setFlockField(f, field as FlockField, r.to);
      rec.add({ item: r.item, field, status: "repaired", from: r.from, to: r.to, note });
    }
  }
}

// Stage: written HD% decimal-digit candidate (existing writtenHdCheck.ts).
function stageWrittenHd(p: PageState, rec: Recorder) {
  for (const f of p.flocks) {
    if (f.hd_percent === null || f.eggs_total === null || f.bird_population === null) continue;
    const r = checkWrittenHdDigitAccuracy(f.hd_percent, calcHd(f.eggs_total, f.bird_population));
    if (r.kind === "auto_correct") {
      rec.add({ item: f.display_label_as_written, field: "hd_percent", status: "repaired", from: f.hd_percent, to: r.correctedWrittenHd, note: r.note });
      f.hd_percent = r.correctedWrittenHd;
    }
  }
}

function runRepairStages(p: PageState, ctx: CorrectionContext, rec: Recorder) {
  stageMortalityChecksum(p, ctx, rec);
  stageChain(p, ctx, rec);
  for (const s of ["main", "continuation"] as const) stageSectionRepair(p, s, rec);
  stageWrittenHd(p, rec);
}

function tableBox(p: PageState, s: Section): NormalizedBox {
  const rows = inSection(p, s);
  const top = Math.min(...rows.map((f) => f.rowBox.y));
  const lastRow = rows.reduce((a, f) => (f.rowBox.y > a.y ? f.rowBox : a), rows[0].rowBox);
  const y = Math.max(0, top - 0.05);
  const bottom = Math.min(1, lastRow.y + lastRow.height + 0.24);
  return { x: 0, y, width: 1, height: Math.max(0.1, bottom - y) };
}

// The ledger sits under its table's subtotal row. The model's per-row boxes
// are only approximate (observed 0.1 of the page height off on the lower
// table), so the crop starts above the table's first row and runs to the
// bottom of the half: table, subtotal and ledger all in view.
function ledgerBox(p: PageState, s: Section): NormalizedBox {
  const rows = inSection(p, s);
  const top = Math.min(...rows.map((f) => f.rowBox.y));
  const y = Math.max(0, top - 0.08);
  return { x: 0, y, width: 1, height: 1 - y };
}

// Which subtotal-row cell a section-level failure is about.
const SUBTOTAL_KEY: Record<string, string> = { sum_eggs: "eggs", sum_mortality: "mortality", sum_feed: "feed_bags", sum_bird: "bal_bird", sum_hd: "hd_percent" };

const IMPLICATED: Record<Failure["kind"], FlockField[]> = {
  missing: [],
  eggs30: ["eggs_total"],
  hd: ["eggs_total", "bird_population", "hd_percent"],
  chain: ["bird_population", "mortality"],
  sum_eggs: ["eggs_total"],
  sum_mortality: ["mortality"],
  sum_feed: ["feed_bags"],
  sum_bird: [],
  sum_hd: [],
  subtotal_missing: [],
};

export async function correctFlockTables(
  p: PageState,
  ctx: CorrectionContext,
  deps: CorrectionDeps,
  rec: Recorder
): Promise<void> {
  const reread = new Set<string>(); // `${label}|${field}` already re-read once
  const subtotalReread = new Set<Section>();

  for (let round = 0; round <= MAX_REREAD_ROUNDS; round++) {
    runRepairStages(p, ctx, rec);
    const failures = flockFailures(p, ctx);
    if (failures.length === 0) return;
    if (round === MAX_REREAD_ROUNDS) break;

    // Pick what to re-read this round (bounded: zoomed single rows, plus at
    // most one subtotal strip per section).
    const rowTargets = new Map<string, Set<FlockField>>(); // label -> fields
    const subtotalTargets = new Set<Section>();
    for (const f of failures) {
      if (f.kind === "subtotal_missing") {
        subtotalTargets.add(f.section);
        continue;
      }
      if (f.label) {
        const set = rowTargets.get(f.label) ?? new Set<FlockField>();
        (f.fields ?? IMPLICATED[f.kind]).forEach((x) => set.add(x));
        rowTargets.set(f.label, set);
        continue;
      }
      // A section-sum failure with no single named culprit: the subtotal
      // strip itself, plus the two least-confident flocks for that field.
      // (Bal Bird / % subtotal failures are about the strip alone, and a
      // written subtotal that genuinely disagrees with its flocks cannot be
      // fixed by looking harder — they are re-read at most once.)
      if (IMPLICATED[f.kind].length === 0) {
        if (!subtotalReread.has(f.section)) subtotalTargets.add(f.section);
        continue;
      }
      subtotalTargets.add(f.section);
      const field = IMPLICATED[f.kind][0];
      const confKey = field as keyof CorrFlock["confidence"];
      const ranked = inSection(p, f.section)
        .filter((x) => !reread.has(`${x.display_label_as_written}|${field}`))
        .sort((a, b) => (a.confidence?.[confKey] ?? 1) - (b.confidence?.[confKey] ?? 1))
        .slice(0, 2);
      for (const x of ranked) {
        const set = rowTargets.get(x.display_label_as_written) ?? new Set<FlockField>();
        set.add(field);
        rowTargets.set(x.display_label_as_written, set);
      }
    }

    // One zoomed call per section that has something to re-read: the whole
    // table block (rows + subtotal strip) at higher resolution. A crop of
    // the table is far sturdier than a crop of one row — the model's
    // per-row boxes are only approximate — and costs one call, not many.
    let changed = false;
    const sectionsToRead = new Set<Section>(subtotalTargets);
    for (const label of rowTargets.keys()) {
      const f = p.flocks.find((x) => x.display_label_as_written === label);
      if (f) sectionsToRead.add(f.section);
    }
    for (const s of sectionsToRead) {
      const rows = inSection(p, s);
      if (rows.length === 0) continue;
      const sectionFailures = failures.filter((x) => x.section === s);
      const hint = `${sectionFailures.map((x) => (x.label ? `${x.label}: ${x.message}` : x.message)).join("; ")}. Read EVERY flock row and the subtotal row (the unlabelled row directly under the last flock, with Mort, Feed, Total, Bal Bird and % figures) with extra care. Likely digit confusions in this handwriting: ${CONFUSIONS}.`;
      rec.rereadCalls++;
      const res = await softly(rec, `${s} table`, () => deps.rereadSection(ctx.images[rows[0].side], s, tableBox(p, s), hint));
      if (subtotalTargets.has(s)) subtotalReread.add(s);
      if (!res) continue;
      for (const [label, fields] of rowTargets) {
        const flock = rows.find((x) => x.display_label_as_written === label);
        if (!flock) continue;
        for (const field of fields) reread.add(`${label}|${field}`);
        const got = res.flocks.find((x) => flockNumber(x.display_label_as_written) === flockNumber(label));
        if (!got) continue;
        // Adopt the zoomed reading of each implicated cell only when it does
        // not make the page's checks worse (a cell that was null is always
        // filled).
        for (const field of fields) {
          const next = got[field];
          if (next === null || next === undefined || next === flock[field]) continue;
          const prior = flock[field];
          const before = flockFailures(p, ctx).length;
          setFlockField(flock, field, next);
          if (prior !== null && flockFailures(p, ctx).length > before) {
            setFlockField(flock, field, prior);
            continue;
          }
          rec.add({ item: label, field, status: "reread", from: prior, to: next, note: `zoomed re-read of the ${s} table (round ${round + 1}) after: ${failures.filter((x) => x.label === label).map((x) => x.message).join("; ")}` });
          changed = true;
        }
      }
      if (subtotalTargets.has(s)) {
        const sub = res.subtotal;
        if (sub && looksLikeGenuineSubtotal(sub)) {
          const cur = p.subtotals[s];
          if (!cur) {
            p.subtotals[s] = { ...sub, section: s };
            rec.add({ item: `subtotal ${s}`, field: "row", status: "reread", from: null, to: sub.eggs, note: `subtotal row was not read the first time; zoomed re-read found eggs ${sub.eggs}, mortality ${sub.mortality}, feed ${sub.feed_bags}` });
            changed = true;
          } else {
            for (const key of ["eggs", "mortality", "feed_bags", "bal_bird", "hd_percent"] as const) {
              const next = sub[key];
              if (next === null || next === cur[key]) continue;
              const prior = cur[key];
              const before = flockFailures(p, ctx).length;
              cur[key] = next;
              if (prior !== null && flockFailures(p, ctx).length > before) {
                cur[key] = prior;
                continue;
              }
              rec.add({ item: `subtotal ${s}`, field: key, status: "reread", from: prior, to: next, note: `zoomed re-read of the ${s} table (round ${round + 1})` });
              changed = true;
            }
          }
        }
      }
    }
    if (!changed && round > 0) {
      // Nothing moved this round and a previous one already tried: stop
      // spending calls on a reading that will not change.
      runRepairStages(p, ctx, rec);
      break;
    }
  }

  for (const f of flockFailures(p, ctx)) {
    const cells = f.label ? f.fields ?? IMPLICATED[f.kind] : [];
    if (f.label) {
      for (const field of cells) rec.add({ item: f.label, field, status: "needs_review", from: null, to: null, note: f.message });
    } else {
      rec.add({ item: `${f.section} table`, field: `sum:${f.kind === "subtotal_missing" ? "*" : SUBTOTAL_KEY[f.kind]}`, status: "needs_review", from: null, to: null, note: f.message });
    }
  }
}

// Two independent readings of the same item: adopt a combination of their
// cells only when exactly ONE combination satisfies every check (so the
// checks, never a coin flip, decide which reading each cell comes from).
function consistentMerge<T>(a: T, b: T, keys: (keyof T)[], failures: (x: T) => number): T | null {
  const differing = keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  const found = new Map<string, T>();
  for (let mask = 0; mask < 1 << differing.length; mask++) {
    const c = { ...a };
    differing.forEach((k, i) => {
      if (mask & (1 << i)) c[k] = b[k];
    });
    if (failures(c) === 0) found.set(JSON.stringify(keys.map((k) => c[k])), c);
  }
  return found.size === 1 ? [...found.values()][0] : null;
}

// ===================================================================
// Egg ledgers — the big-ledger quirk
// ===================================================================

// Owner rule, 2026-10-21: on the big ledger the number written next to "(+)"
// is the OPENING balance; "produced" is the day's subtotal (the table's
// subtotal row Total); total = OB + produced; closing = total minus the
// deductions. Applied to both ledgers (the small one is laid out the same).
// A bare number sitting between two deductions is a running remainder
// (total minus the deductions so far) and is dropped, not counted as one.
export function normalizeLedgerQuirk(
  raw: ExtractedEggLedgerRegion,
  produced: number | null
): { ledger: ExtractedEggLedgerRegion; notes: string[] } {
  const notes: string[] = [];
  const l: ExtractedEggLedgerRegion = { ...raw, deductions: raw.deductions.map((d) => ({ ...d })) };

  if (l.opening_balance_eggs === null && l.total_eggs_produced !== null && produced !== null && l.total_eggs_produced !== produced) {
    notes.push(`the figure read next to "(+)" (${l.total_eggs_produced}) is the opening balance, not production`);
    l.opening_balance_eggs = l.total_eggs_produced;
  }
  if (produced !== null && l.total_eggs_produced !== produced) {
    if (l.total_eggs_produced !== null && l.total_eggs_produced !== l.opening_balance_eggs) {
      notes.push(`produced ${l.total_eggs_produced} replaced by the day's subtotal ${produced}`);
    }
    l.total_eggs_produced = produced;
  } else if (produced === null && l.total_eggs_produced === l.opening_balance_eggs) {
    l.total_eggs_produced = null;
  }

  if (l.total_line_eggs !== null) {
    let remainder = l.total_line_eggs;
    const kept: typeof l.deductions = [];
    for (const d of l.deductions) {
      if (kept.length > 0 && d.amount_eggs === remainder) {
        notes.push(`"${d.label_as_written}" ${d.amount_eggs} is the running remainder, not a deduction`);
        continue;
      }
      kept.push(d);
      remainder -= d.amount_eggs;
    }
    // The first line can itself be the written remainder when the model
    // read the total line twice.
    l.deductions = kept;
  }
  return { ledger: l, notes };
}

function ledgerFailureMessages(l: ExtractedEggLedgerRegion): string[] {
  const out: string[] = [];
  const all = [l.opening_balance_eggs, l.total_eggs_produced, l.total_line_eggs, l.closing_balance_eggs, ...l.deductions.map((d) => d.amount_eggs)];
  if (all.some((v) => v !== null && v % 30 !== 0)) out.push("a figure is not a multiple of 30");
  if (l.opening_balance_eggs === null) out.push("opening balance (the number next to \"(+)\") was not read");
  if (l.opening_balance_eggs !== null && l.total_eggs_produced !== null && l.total_line_eggs !== null && l.opening_balance_eggs + l.total_eggs_produced !== l.total_line_eggs) {
    out.push(`opening ${l.opening_balance_eggs} + produced ${l.total_eggs_produced} = ${l.opening_balance_eggs + l.total_eggs_produced}, but the total line reads ${l.total_line_eggs}`);
  }
  if (l.total_line_eggs !== null && l.closing_balance_eggs !== null) {
    const ded = l.deductions.reduce((t, d) => t + d.amount_eggs, 0);
    if (l.total_line_eggs - ded !== l.closing_balance_eggs) out.push(`total ${l.total_line_eggs} minus deductions ${ded} = ${l.total_line_eggs - ded}, but closing reads ${l.closing_balance_eggs}`);
  }
  if (l.total_line_eggs === null) out.push("total line was not read");
  if (l.closing_balance_eggs === null) out.push("closing balance was not read");
  return out;
}

function repairLedger(l: ExtractedEggLedgerRegion, section: EggStockSection, prevClosing: number | null): { ledger: ExtractedEggLedgerRegion; note: string | null; field: string | null; from: number | null; to: number | null } {
  const r = resolveEggLedgerSection(
    {
      section,
      openingBalanceEggs: l.opening_balance_eggs,
      totalEggsProduced: l.total_eggs_produced,
      totalLineEggs: l.total_line_eggs,
      deductions: l.deductions.map((d) => ({ labelAsWritten: d.label_as_written, amountEggs: d.amount_eggs, categoryGuess: d.category_guess, confidence: d.confidence })),
      closingBalanceEggs: l.closing_balance_eggs,
    },
    { flockEggsSum: null, previousClosingBalanceEggs: prevClosing }
  );
  if (!r.autoCorrectionNote) return { ledger: l, note: null, field: null, from: null, to: null };
  const next: ExtractedEggLedgerRegion = {
    ...l,
    opening_balance_eggs: r.openingBalanceEggs,
    total_eggs_produced: r.totalEggsProduced,
    total_line_eggs: r.totalLineEggs,
    closing_balance_eggs: r.closingBalanceEggs,
    deductions: l.deductions.map((d, i) => ({ ...d, amount_eggs: r.deductions[i].amountEggs })),
  };
  let field = "";
  let from: number | null = null;
  let to: number | null = null;
  if (r.openingBalanceEggsOriginal !== null) [field, from, to] = ["opening_balance_eggs", r.openingBalanceEggsOriginal, r.openingBalanceEggs];
  else if (r.totalEggsProducedOriginal !== null) [field, from, to] = ["total_eggs_produced", r.totalEggsProducedOriginal, r.totalEggsProduced];
  else if (r.totalLineEggsOriginal !== null) [field, from, to] = ["total_line_eggs", r.totalLineEggsOriginal, r.totalLineEggs];
  else if (r.closingBalanceEggsOriginal !== null) [field, from, to] = ["closing_balance_eggs", r.closingBalanceEggsOriginal, r.closingBalanceEggs];
  else {
    const i = r.deductions.findIndex((d) => d.amountEggsOriginal !== null);
    [field, from, to] = [`deduction ${i + 1}`, r.deductions[i].amountEggsOriginal, r.deductions[i].amountEggs];
  }
  return { ledger: next, note: r.autoCorrectionNote, field, from, to };
}

export async function correctLedgers(
  p: PageState,
  ctx: CorrectionContext,
  deps: CorrectionDeps,
  rec: Recorder
): Promise<void> {
  for (const section of ["big", "small"] as const) {
    const tableSection: Section = section === "big" ? "main" : "continuation";
    const flocks = inSection(p, tableSection);
    const item = `${section} ledger`;
    // "Produced" = the day's subtotal; the section's own flock sum stands
    // in only when no subtotal row was read.
    const subEggs = trustedSubtotal(p, tableSection)?.eggs ?? null;
    const flockSum = flocks.length > 0 && flocks.every((f) => f.eggs_total !== null) ? flocks.reduce((t, f) => t + (f.eggs_total as number), 0) : null;
    let produced = subEggs ?? flockSum;
    if (subEggs !== null && flockSum !== null && subEggs !== flockSum) {
      // The subtotal row and the flock rows disagree (flagged on the table
      // itself); let the ledger's own arithmetic say which one it used.
      const l0 = p.ledgers.get(section)?.ledger;
      const ob = l0 ? l0.opening_balance_eggs ?? l0.total_eggs_produced : null;
      const own = l0 && l0.total_line_eggs !== null && ob !== null ? l0.total_line_eggs - ob : null;
      produced = own === subEggs ? subEggs : flockSum;
    }
    const side = p.ledgers.get(section)?.side ?? p.tableSide.get(tableSection) ?? "left";
    const box: NormalizedBox = flocks.length > 0 ? ledgerBox(p, tableSection) : { x: 0, y: 0.4, width: 1, height: 0.6 };

    let current: ExtractedEggLedgerRegion | null = null;
    const first = p.ledgers.get(section)?.ledger ?? null;
    if (first) {
      const n = normalizeLedgerQuirk(first, produced);
      current = n.ledger;
      for (const note of n.notes) rec.log.push(`${item}: ${note}`);
    }

    let outcomeFailures: string[] = [];
    for (let round = 0; round <= MAX_REREAD_ROUNDS; round++) {
      outcomeFailures = current ? ledgerFailureMessages(current) : ["no ledger was found on this half"];
      if (current && outcomeFailures.length > 0) {
        const fix = repairLedger(current, section, null);
        if (fix.note) {
          rec.add({ item, field: fix.field as string, status: "repaired", from: fix.from, to: fix.to, note: fix.note });
          current = fix.ledger;
          outcomeFailures = ledgerFailureMessages(current);
        }
      }
      if (outcomeFailures.length === 0 || round === MAX_REREAD_ROUNDS) break;

      const hint = `${outcomeFailures.join("; ")}. Remember: the figure ${produced ?? "on the subtotal row"} on the table's SUBTOTAL ROW just above the ledger is the day's produced figure — it is NOT the opening balance and NOT a deduction; the ledger itself starts on the next line, the one written with a "(+)" sign, and the number right after that "(+)" is the opening balance; the total line is opening + the day's produced figure (${produced ?? "see the subtotal row"}); a bare number between deductions is a running remainder, not a deduction. The crop also shows the flock table and its subtotal row ABOVE the ledger — read only the ledger under the subtotal row. Likely digit confusions: ${CONFUSIONS}.`;
      rec.rereadCalls++;
      const res = await softly(rec, item, () => deps.rereadLedger(ctx.images[side], section, box, hint));
      if (!res) continue;
      const n = normalizeLedgerQuirk(res, produced);
      const before = current ? ledgerFailureMessages(current).length : Infinity;
      const after = ledgerFailureMessages(n.ledger).length;
      const keys = ["opening_balance_eggs", "total_eggs_produced", "total_line_eggs", "closing_balance_eggs", "deductions"] as const;
      const merged = current ? consistentMerge(current, n.ledger, [...keys], (x) => ledgerFailureMessages(x).length) : null;
      const next = merged ?? (after < before ? n.ledger : null);
      if (next) {
        rec.add({ item, field: "ledger", status: "reread", from: null, to: null, note: `zoomed re-read (round ${round + 1}) after: ${outcomeFailures.join("; ")}${n.notes.length ? ` [${n.notes.join("; ")}]` : ""}${merged ? " — adopted the one combination of the two readings that satisfies every check" : ""}` });
        current = next;
      }
    }
    if (outcomeFailures.length > 0) {
      for (const m of outcomeFailures) rec.add({ item, field: "ledger", status: "needs_review", from: null, to: null, note: m });
    }
    // Cross-day warning only (owner rule): opening vs previous closing.
    const prev = ctx.prevLedgerClosing[section] ?? null;
    if (current && prev !== null && current.opening_balance_eggs !== null && current.opening_balance_eggs !== prev) {
      const fix = outcomeFailures.length === 0 ? null : repairLedger(current, section, prev);
      if (fix?.note) {
        rec.add({ item, field: fix.field as string, status: "repaired", from: fix.from, to: fix.to, note: fix.note });
        current = fix.ledger;
      } else {
        rec.warnings.push(`${item}: opening ${current.opening_balance_eggs} differs from the previous day's closing ${prev} (warning only — may be a genuine re-count).`);
      }
    }
    if (current) p.ledgers.set(section, { side, ledger: current });
    else p.ledgers.delete(section);
  }
}

// ===================================================================
// Feed boxes — identified by content, not label
// ===================================================================

export function groupOfFlock(label: string): FeedBoxGroupLabel | null {
  const n = flockNumber(label);
  if (n === null) return null;
  return n <= 7 ? "BAB-1-7" : "BAB-8-10";
}

export function flockFeedSums(flocks: { display_label_as_written: string; feed_bags: number | null }[]): Record<FeedBoxGroupLabel, number | null> {
  const sums: Record<FeedBoxGroupLabel, number | null> = { "BAB-1-7": 0, "BAB-8-10": 0, ALL: 0 };
  const seen: Record<string, number> = { "BAB-1-7": 0, "BAB-8-10": 0 };
  for (const f of flocks) {
    const g = groupOfFlock(f.display_label_as_written);
    if (!g) continue;
    seen[g]++;
    for (const key of [g, "ALL" as const]) sums[key] = sums[key] === null || f.feed_bags === null ? null : (sums[key] as number) + f.feed_bags;
  }
  if (seen["BAB-1-7"] === 0) sums["BAB-1-7"] = null;
  if (seen["BAB-8-10"] === 0) sums["BAB-8-10"] = null;
  if (seen["BAB-1-7"] + seen["BAB-8-10"] === 0) sums.ALL = null;
  return sums;
}

function filled(b: ExtractedFeedBoxRegion): number {
  return [b.opening_balance_bags, b.produced_bags, b.total_bags, b.closing_balance_bags, b.consumed_bags, b.mill_inventory_bags, b.shed_inventory_bags].filter((v) => v !== null).length;
}

// The model sometimes reports one box as two fragments (the OB/(+) lines,
// then the F=/S= lines further down the same column). Fragments sharing a
// label are merged: the fuller one wins, nulls are filled from the other.
function mergeFragments(boxes: FeedBoxEntry[]): FeedBoxEntry[] {
  const byLabel = new Map<FeedBoxGroupLabel, FeedBoxEntry[]>();
  for (const b of boxes) byLabel.set(b.group, [...(byLabel.get(b.group) ?? []), b]);
  const merged: FeedBoxEntry[] = [];
  for (const group of byLabel.values()) {
    const sorted = [...group].sort((a, b) => filled(b.box) - filled(a.box));
    const base = { ...sorted[0], box: { ...sorted[0].box } };
    for (const other of sorted.slice(1)) {
      for (const k of ["opening_balance_bags", "produced_bags", "total_bags", "closing_balance_bags", "consumed_bags", "mill_inventory_bags", "shed_inventory_bags"] as const) {
        if (base.box[k] === null && other.box[k] !== null) base.box[k] = other.box[k];
      }
    }
    base.index = Math.min(...group.map((g) => g.index));
    merged.push(base);
  }
  return merged.sort((a, b) => a.index - b.index);
}

export function assignFeedBoxesByContent(boxes: FeedBoxEntry[], sums: Record<FeedBoxGroupLabel, number | null>): FeedBoxEntry[] {
  let list = mergeFragments(boxes);
  if (list.length > 2) list = [...list].sort((a, b) => filled(b.box) - filled(a.box)).slice(0, 2).sort((a, b) => a.index - b.index);
  const cost = (b: FeedBoxEntry, g: FeedBoxGroupLabel) => (b.box.consumed_bags === null || sums[g] === null ? 1000 : Math.abs(b.box.consumed_bags - (sums[g] as number)));

  if (list.length === 1) {
    const b = list[0];
    const options: FeedBoxGroupLabel[] = ["BAB-1-7", "BAB-8-10", "ALL"];
    const scored = options.map((g) => ({ g, c: cost(b, g) })).sort((x, y) => x.c - y.c);
    if (scored[0].c === 0 && scored[1].c !== 0) return [{ ...b, group: scored[0].g, assignedBy: "consumed_matches_flock_feed" }];
    return [{ ...b, assignedBy: "model_label" }];
  }
  if (list.length === 2) {
    const [a, b] = list;
    const straight = cost(a, "BAB-1-7") + cost(b, "BAB-8-10");
    const swapped = cost(a, "BAB-8-10") + cost(b, "BAB-1-7");
    if (straight < swapped) return [{ ...a, group: "BAB-1-7", assignedBy: "consumed_matches_flock_feed" }, { ...b, group: "BAB-8-10", assignedBy: "consumed_matches_flock_feed" }];
    if (swapped < straight) return [{ ...a, group: "BAB-8-10", assignedBy: "consumed_matches_flock_feed" }, { ...b, group: "BAB-1-7", assignedBy: "consumed_matches_flock_feed" }];
    // No consumption evidence either way: the model's own labels if they
    // are distinct, else left-to-right (left = BAB-1..7).
    if (a.group !== b.group && a.group !== "ALL" && b.group !== "ALL") return [{ ...a, assignedBy: "model_label" }, { ...b, assignedBy: "model_label" }];
    return [{ ...a, group: "BAB-1-7", assignedBy: "position" }, { ...b, group: "BAB-8-10", assignedBy: "position" }];
  }
  return list;
}

function feedFailureMessages(b: ExtractedFeedBoxRegion, flockSum: number | null): string[] {
  const out: string[] = [];
  if (b.opening_balance_bags !== null && b.produced_bags !== null && b.total_bags !== null && b.opening_balance_bags + b.produced_bags !== b.total_bags) out.push(`OB ${b.opening_balance_bags} + received ${b.produced_bags} = ${b.opening_balance_bags + b.produced_bags}, but the total reads ${b.total_bags}`);
  if (b.total_bags !== null && b.closing_balance_bags !== null && b.consumed_bags !== null && b.total_bags - b.closing_balance_bags !== b.consumed_bags) out.push(`total ${b.total_bags} minus closing ${b.closing_balance_bags} = ${b.total_bags - b.closing_balance_bags}, but consumed reads ${b.consumed_bags}`);
  if (b.mill_inventory_bags !== null && b.shed_inventory_bags !== null && b.closing_balance_bags !== null && b.mill_inventory_bags + b.shed_inventory_bags !== b.closing_balance_bags) out.push(`F ${b.mill_inventory_bags} + S ${b.shed_inventory_bags} = ${b.mill_inventory_bags + b.shed_inventory_bags}, but the closing reads ${b.closing_balance_bags}`);
  if (flockSum !== null && b.consumed_bags !== null && b.consumed_bags !== flockSum) out.push(`consumed ${b.consumed_bags} differs from the covered flocks' feed bags sum ${flockSum}`);
  for (const [k, v] of Object.entries({ OB: b.opening_balance_bags, received: b.produced_bags, total: b.total_bags, closing: b.closing_balance_bags, consumed: b.consumed_bags, F: b.mill_inventory_bags, S: b.shed_inventory_bags })) {
    if (v === null) out.push(`${k} was not read`);
  }
  return out;
}

function repairFeed(b: ExtractedFeedBoxRegion, group: FeedBoxGroupLabel, flockSum: number | null): { box: ExtractedFeedBoxRegion; note: string | null; field: string | null; from: number | null; to: number | null } {
  const r = resolveFeedBox(
    {
      flockGroup: group,
      openingBalanceBags: b.opening_balance_bags,
      producedBags: b.produced_bags,
      totalBags: b.total_bags,
      closingBalanceBags: b.closing_balance_bags,
      consumedBags: b.consumed_bags,
      millInventoryBags: b.mill_inventory_bags,
      shedInventoryBags: b.shed_inventory_bags,
    },
    { flockFeedBagsSum: flockSum, previousClosingBalanceBags: null }
  );
  if (!r.autoCorrectionNote) return { box: b, note: null, field: null, from: null, to: null };
  const next: ExtractedFeedBoxRegion = {
    ...b,
    opening_balance_bags: r.openingBalanceBags,
    produced_bags: r.producedBags,
    total_bags: r.totalBags,
    closing_balance_bags: r.closingBalanceBags,
    consumed_bags: r.consumedBags,
    mill_inventory_bags: r.millInventoryBags,
    shed_inventory_bags: r.shedInventoryBags,
  };
  const pairs: [string, number | null, number | null][] = [
    ["opening_balance_bags", r.openingBalanceBagsOriginal, r.openingBalanceBags],
    ["produced_bags", r.producedBagsOriginal, r.producedBags],
    ["total_bags", r.totalBagsOriginal, r.totalBags],
    ["consumed_bags", r.consumedBagsOriginal, r.consumedBags],
    ["mill_inventory_bags", r.millInventoryBagsOriginal, r.millInventoryBags],
    ["shed_inventory_bags", r.shedInventoryBagsOriginal, r.shedInventoryBags],
    ["closing_balance_bags", r.closingBalanceBagsOriginal, r.closingBalanceBags],
  ];
  const hit = pairs.find((x) => x[1] !== null)!;
  return { box: next, note: r.autoCorrectionNote, field: hit[0], from: hit[1], to: hit[2] };
}

function feedBoxCrop(p: PageState, entry: FeedBoxEntry): NormalizedBox {
  const rows = p.flocks.filter((f) => f.side === entry.side);
  const firstY = rows.length > 0 ? Math.min(...rows.map((f) => f.rowBox.y)) : 0.55;
  const height = Math.max(0.25, Math.min(1, firstY - 0.03));
  // Two boxes sit side by side: crop the half of the strip the box is in.
  const leftBox = entry.index === 0;
  return { x: leftBox ? 0 : 0.5, y: 0, width: 0.5, height };
}

export async function correctFeedBoxes(
  p: PageState,
  ctx: CorrectionContext,
  deps: CorrectionDeps,
  rec: Recorder
): Promise<void> {
  const sums = flockFeedSums(p.flocks);
  let assigned = assignFeedBoxesByContent(p.feedBoxes, sums);
  // Two boxes are expected whenever both flock groups exist on the page.
  // A box the first read missed entirely gets a blank entry so it is
  // re-read from a zoomed crop of the strip above the table (the boxes sit
  // side by side near the top of the page that carries the shorter table).
  const expected = sums["BAB-1-7"] !== null && sums["BAB-8-10"] !== null ? 2 : 1;
  if (assigned.length < expected) {
    const side: HalfSide = assigned[0]?.side ?? p.tableSide.get("continuation") ?? (p.tableSide.get("main") === "left" ? "right" : "left");
    const used = new Set(assigned.map((a) => a.index));
    const blank = (): ExtractedFeedBoxRegion => ({
      opening_balance_bags: null, produced_bags: null, total_bags: null, closing_balance_bags: null,
      consumed_bags: null, mill_inventory_bags: null, shed_inventory_bags: null, region_notes: null,
      confidence: { opening_balance_bags: 0, produced_bags: 0, total_bags: 0, closing_balance_bags: 0, consumed_bags: 0, mill_inventory_bags: 0, shed_inventory_bags: 0 },
    });
    assigned = [...assigned];
    for (let i = 0; i < expected; i++) {
      if (used.has(i) || assigned.length >= expected) continue;
      assigned.push({ group: expected === 2 ? (i === 0 ? "BAB-1-7" : "BAB-8-10") : "ALL", side, index: i, box: blank(), assignedBy: "position" });
      rec.log.push(`feed box #${i + 1} (left to right) was not found in the first read — re-reading the strip above the table`);
    }
    assigned.sort((a, b) => a.index - b.index);
  }
  const out: FeedBoxEntry[] = [];

  for (const entry of assigned) {
    if (entry.assignedBy !== "as_read") {
      const changed = p.feedBoxes.find((b) => b.group === entry.group && b.index === entry.index) === undefined;
      rec.log.push(`feed box #${entry.index + 1} (left to right) identified as ${entry.group} by ${entry.assignedBy.replace(/_/g, " ")}${changed ? " (differs from the label the model gave)" : ""}`);
    }
    let cur = entry.box;
    let msgs: string[] = [];
    const item = `${entry.group} feed box`;
    for (let round = 0; round <= MAX_REREAD_ROUNDS; round++) {
      msgs = feedFailureMessages(cur, sums[entry.group]);
      if (msgs.length > 0) {
        const fix = repairFeed(cur, entry.group, sums[entry.group]);
        if (fix.note) {
          rec.add({ item, field: fix.field as string, status: "repaired", from: fix.from, to: fix.to, note: fix.note });
          cur = fix.box;
          msgs = feedFailureMessages(cur, sums[entry.group]);
        }
      }
      if (msgs.length === 0 || round === MAX_REREAD_ROUNDS) break;
      const hint = `${msgs.join("; ")}. This crop shows ONE feed box (the ${entry.index === 0 ? "left" : "right"} one of two side by side): its OB/(+)/total/(-)/consumed lines at the top and its F=/S= lines lower down in the same column. Its consumed figure must equal ${sums[entry.group] ?? "the covered flocks' feed bags"}. Likely digit confusions: ${CONFUSIONS}.`;
      rec.rereadCalls++;
      const res = await softly(rec, item, () => deps.rereadFeedBox(ctx.images[entry.side], entry.group, feedBoxCrop(p, entry), hint));
      if (!res) continue;
      const fails = (x: ExtractedFeedBoxRegion) => feedFailureMessages(x, sums[entry.group]).length;
      const keys = ["opening_balance_bags", "produced_bags", "total_bags", "closing_balance_bags", "consumed_bags", "mill_inventory_bags", "shed_inventory_bags"] as const;
      const merged = consistentMerge(cur, res, [...keys], fails);
      const next = merged ?? (fails(res) < fails(cur) ? res : null);
      if (next) {
        rec.add({ item, field: "box", status: "reread", from: null, to: null, note: `zoomed re-read (round ${round + 1}) after: ${msgs.join("; ")}${merged ? " — adopted the one combination of the two readings that satisfies every check" : ""}` });
        cur = next;
      }
    }
    for (const m of msgs) rec.add({ item, field: "box", status: "needs_review", from: null, to: null, note: m });
    // Cross-day warning only: the supervisor re-counts this box every two
    // days, so opening need not equal the previous closing.
    const prev = ctx.prevFeedClosing[entry.group] ?? null;
    if (prev !== null && cur.opening_balance_bags !== null && cur.opening_balance_bags !== prev) {
      rec.warnings.push(`${item}: opening ${cur.opening_balance_bags} differs from the previous day's closing ${prev} (warning only).`);
    }
    out.push({ ...entry, box: cur });
  }
  // The re-reads may have filled in boxes whose group was only a position
  // guess; settle the final groups by content again.
  p.feedBoxes = out.length === 2 ? assignFeedBoxesByContent(out, sums).map((e) => ({ ...e, assignedBy: e.assignedBy === "as_read" ? "position" : e.assignedBy })) : out;
}

// ===================================================================
// Orchestrator
// ===================================================================

export interface CorrectionRun {
  corrected: PageState;
  report: CorrectionReport;
}

export async function runCorrectionStages(
  raw: PageState,
  ctx: CorrectionContext,
  deps: CorrectionDeps = liveCorrectionDeps
): Promise<CorrectionRun> {
  const corrected = clonePage(raw);
  const rec = new Recorder();
  await correctFlockTables(corrected, ctx, deps, rec);
  await correctLedgers(corrected, ctx, deps, rec);
  await correctFeedBoxes(corrected, ctx, deps, rec);
  return { corrected, report: { outcomes: rec.outcomes, rereadCalls: rec.rereadCalls, warnings: rec.warnings, log: rec.log } };
}

export type { PageHalfExtraction };
