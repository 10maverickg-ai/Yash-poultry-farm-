import type { Pool, PoolClient } from "pg";

export interface ActiveLabel {
  displayLabel: string;
  flockInternalId: string;
}

/**
 * Canonicalizes a flock label for forgiving comparison — collapses the
 * cosmetic formatting differences a handwritten register or an OCR read
 * routinely introduces (spacing, case, hyphen vs space vs nothing, leading
 * zeros) WITHOUT touching the actual identifying digits.
 *
 * Deliberately NOT edit-distance / "close enough" matching: this farm's own
 * labels (BAB-1 .. BAB-10) differ from each other by exactly one character,
 * so treating a one-character difference as "probably the same flock" would
 * risk silently filing one flock's numbers under a different real flock's
 * identity — worse than leaving the row for manual review. Only exact
 * equality on the normalized form counts as a match.
 */
export function normalizeFlockLabel(label: string): string {
  let s = label.trim().toUpperCase();
  s = s.replace(/[\s_]+/g, "-"); // spaces/underscores -> hyphen

  // This farm's flocks are always "BAB-<number>" (see the extraction
  // prompt's LABELS section), but a handwritten "B" is sometimes OCR'd as a
  // stray leading digit or two before the real "AB" is read correctly —
  // observed on the 2026-08-02 page as "18AB-1" and "13AB-1" (both meaning
  // BAB-1). A leading 1-2 digit run directly followed by "AB" is normalized
  // to "BAB" here; the flock NUMBER itself (whatever follows "AB") is never
  // touched — only the misread prefix is corrected, and only when it's
  // unambiguously this specific pattern (a real "BAB-<n>" label never
  // starts with a digit, so this can't misfire on an already-correct one).
  s = s.replace(/^\d{1,2}-?AB(?![A-Z])/, "BAB");

  s = s.replace(/([A-Z]+)(\d)/g, "$1-$2"); // "BAB1" -> "BAB-1"
  s = s.replace(/(\d)([A-Z]+)/g, "$1-$2"); // "1BAB" -> "1-BAB"
  s = s.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  s = s.replace(/\d+/g, (digits) => String(parseInt(digits, 10))); // strip leading zeros
  return s;
}

/** Every label active for this farm on this date, per flock_label_history —
 * fetched once per upload and matched against in memory, rather than one
 * query per flock. Takes a plain Pool as well as a transaction's PoolClient
 * (both expose a compatible .query) so the upload flow can fetch this once,
 * before opening the write transaction — needed to sanity-check a runaway
 * extraction's row count before any DB work starts. */
export async function getActiveLabels(
  client: Pool | PoolClient,
  farmCode: string,
  date: string
): Promise<ActiveLabel[]> {
  const { rows } = await client.query(
    `SELECT h.display_label, h.flock_internal_id
       FROM flock_label_history h
       JOIN flocks f ON f.flock_internal_id = h.flock_internal_id
      WHERE f.farm_code = $1
        AND h.effective_from <= $2
        AND (h.effective_to IS NULL OR h.effective_to >= $2)`,
    [farmCode, date]
  );
  return rows.map((r) => ({
    displayLabel: r.display_label,
    flockInternalId: r.flock_internal_id,
  }));
}

export interface LabelMatch {
  flockInternalId: string | null;
  // True if the match only succeeded after normalization or number-only
  // matching (not a byte-exact match) — worth knowing even on a successful
  // match, since a persistently fuzzy-only match for a label might mean
  // flock_label_history itself should be updated to match how the register
  // is actually written.
  wasFuzzy: boolean;
}

/** Last contiguous run of digits in the label, as an integer — e.g. "18AB-2"
 * (a real misread: the model's "BAB" letters came out as a stray leading
 * "18") gives 2, not 18, because the flock number is what comes after the
 * letters, and a spurious leading digit run from a garbled prefix is the
 * observed failure mode here. Returns null if the label has no digits at
 * all (e.g. a Roman numeral the extraction prompt failed to convert). */
function lastDigitRun(label: string): number | null {
  const runs = label.match(/\d+/g);
  if (!runs || runs.length === 0) return null;
  return parseInt(runs[runs.length - 1], 10);
}

/**
 * Matches by flock number ALONE, ignoring any letter prefix entirely —
 * every flock on this farm is "BAB" followed by a number, the letters carry
 * no identifying information, and they're exactly the part of the label
 * handwriting recognition struggles with (see normalizeFlockLabel's own
 * note on this farm's numbers, BAB-1..BAB-10, differing by one character).
 * Comparison is still EXACT on the number itself once parsed — never "off
 * by one" or edit-distance tolerant — so BAB-1 and BAB-10 still can never
 * be confused; this only removes the requirement that the prefix letters
 * also match, since they were never what distinguished one flock from
 * another in the first place.
 */
function matchByNumber(rawLabel: string, active: ActiveLabel[]): LabelMatch {
  const rawNumber = lastDigitRun(rawLabel);
  if (rawNumber === null) return { flockInternalId: null, wasFuzzy: false };

  const candidates = active.filter((a) => lastDigitRun(a.displayLabel) === rawNumber);
  if (candidates.length === 1) {
    return { flockInternalId: candidates[0].flockInternalId, wasFuzzy: true };
  }
  // Zero candidates: no active flock has this number. More than one: two
  // active labels share a number (only possible if this farm ever has
  // flocks under different prefixes at once) — genuinely ambiguous once the
  // prefix is ignored, so don't guess between them.
  return { flockInternalId: null, wasFuzzy: false };
}

export function matchFlockLabel(rawLabel: string, active: ActiveLabel[]): LabelMatch {
  const exact = active.find((a) => a.displayLabel === rawLabel);
  if (exact) return { flockInternalId: exact.flockInternalId, wasFuzzy: false };

  const normalized = normalizeFlockLabel(rawLabel);
  const candidates = active.filter((a) => normalizeFlockLabel(a.displayLabel) === normalized);
  if (candidates.length === 1) {
    return { flockInternalId: candidates[0].flockInternalId, wasFuzzy: true };
  }
  if (candidates.length > 1) {
    // Two active labels normalize to the same form — a flock_label_history
    // data problem, not something to guess between.
    return { flockInternalId: null, wasFuzzy: false };
  }

  // Full-label normalization found nothing — fall back to matching on the
  // number alone (owner report, 2026-09-28: the model was consistently
  // misreading the untidy "BAB" prefix as stray digits/letters while
  // reading the actual flock number correctly).
  return matchByNumber(rawLabel, active);
}

/**
 * Collapses rows sharing the same normalized label down to the first
 * occurrence of each — a defense against a runaway extraction that repeats
 * the same flock block over and over (owner report, 2026-09-28: a photo of
 * the Aug 2 register came back with 2774+ "flocks" for a 10-flock page).
 * This is a coarse sanity-check tool, not a data-quality mechanism: it
 * doesn't try to pick the "best" of several genuinely different readings
 * for the same flock, it just removes exact-label repeats so a repetition
 * loop that emits identical rows over and over doesn't get mistaken for
 * hundreds of distinct flocks. A loop that mutates its output slightly each
 * time (different label text each repeat) won't collapse here — that's by
 * design, since it means the extraction is actually inventing content
 * rather than harmlessly repeating good data, and the caller's row-count
 * sanity check (against the farm's known active flock count) is what
 * catches that case.
 */
export function dedupeByNormalizedLabel<T>(
  rows: T[],
  labelOf: (row: T) => string
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const row of rows) {
    const key = normalizeFlockLabel(labelOf(row));
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}
