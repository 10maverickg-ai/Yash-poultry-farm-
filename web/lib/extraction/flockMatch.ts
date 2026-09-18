import type { PoolClient } from "pg";

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
  s = s.replace(/([A-Z]+)(\d)/g, "$1-$2"); // "BAB1" -> "BAB-1"
  s = s.replace(/(\d)([A-Z]+)/g, "$1-$2"); // "1BAB" -> "1-BAB"
  s = s.replace(/-+/g, "-").replace(/^-+|-+$/g, "");
  s = s.replace(/\d+/g, (digits) => String(parseInt(digits, 10))); // strip leading zeros
  return s;
}

/** Every label active for this farm on this date, per flock_label_history —
 * fetched once per upload and matched against in memory, rather than one
 * query per flock. */
export async function getActiveLabels(
  client: PoolClient,
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
  // True if the match only succeeded after normalization (not a byte-exact
  // match) — worth knowing even on a successful match, since a persistently
  // fuzzy-only match for a label might mean flock_label_history itself
  // should be updated to match how the register is actually written.
  wasFuzzy: boolean;
}

export function matchFlockLabel(rawLabel: string, active: ActiveLabel[]): LabelMatch {
  const exact = active.find((a) => a.displayLabel === rawLabel);
  if (exact) return { flockInternalId: exact.flockInternalId, wasFuzzy: false };

  const normalized = normalizeFlockLabel(rawLabel);
  const candidates = active.filter((a) => normalizeFlockLabel(a.displayLabel) === normalized);

  if (candidates.length === 1) {
    return { flockInternalId: candidates[0].flockInternalId, wasFuzzy: true };
  }
  // Zero candidates: genuinely no match. More than one: two active labels
  // normalize to the same form, which is itself a flock_label_history data
  // problem — don't guess between them either way.
  return { flockInternalId: null, wasFuzzy: false };
}
