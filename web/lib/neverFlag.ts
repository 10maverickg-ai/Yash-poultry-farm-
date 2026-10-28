// V5 section 3 / section 2 — things the owner has confirmed are NOT problems.
// They never appear in the flag review queue and never raise an alert, even
// when a validation function still marks the stored row flagged. Nothing here
// edits a row: it is only a filter at read time, so the history stays intact.
//
//  - every row dated in August 2026 (the owner cleared August on 2026-10-19). July was never cleared: the data added on
//    27-28 Oct starts on 2 Jul, and its open questions (29/30 Jul +300 small eggs, the 30 Jul ledger gap) must show.
//  - Sep 8 / Sep 9 feed-bag cells (supervisor's numbers, accepted as entered)
//  - Sep 15 BAB-3 eggs written 420 / 4,020 needed by the page total
//  - Sep 15 breakage line written 890 where the arithmetic gives 390
//  - Sep 20 page subtotal 30 eggs short
//  - Sep 25 big-ledger opening 30 eggs below Sep 24's closing
//  - unlabelled egg-ledger lines (owner: breakage, or a move to small eggs)
//  - feed-box opening vs previous closing (the box is recorded every 2 days)
//  - supervisor arithmetic errors inside the feed box, truncated HD%

export const CLEARED_FROM = "2026-08-01";
export const CLEARED_BEFORE = "2026-09-01";
/** August 2026 only. */
export const isCleared = (date: string): boolean => date >= CLEARED_FROM && date < CLEARED_BEFORE;

export function isNeverFlaggedProduction(date: string, reason: string | null): boolean {
  if (isCleared(date)) return true;
  const r = reason ?? "";
  if ((date === "2026-09-08" || date === "2026-09-09") && /feed/i.test(r)) return true;
  if (date === "2026-09-15" && /eggs? written as 420/i.test(r)) return true;
  return false;
}

export function isNeverFlaggedLedgerGap(date: string, section: string, diff: number): boolean {
  if (isCleared(date)) return true;
  return date === "2026-09-25" && section === "big" && Math.abs(diff) === 30;
}

export function isNeverFlaggedEggEntry(date: string, label: string): boolean {
  if (isCleared(date)) return true;
  if (/^\(?unlabell?ed/i.test(label.trim())) return true;
  if (date === "2026-09-15" && /written 890/i.test(label)) return true;
  return false;
}

export function isNeverFlaggedPageIssue(date: string): boolean {
  return isCleared(date) || date === "2026-09-20";
}
