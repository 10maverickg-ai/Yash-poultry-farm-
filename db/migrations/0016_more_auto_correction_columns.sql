-- =============================================================================
-- Migration 0016: mortality/eggs auto-correction audit trail (owner
-- request, 2026-09-29 — "stop finding a new bug every time a new photo is
-- uploaded")
--
-- Migration 0015 added bird_population_original/auto_correction_note for
-- the day-to-day bal-bird chain's auto-correction. This increment adds two
-- more auto-correction paths on the same row (a mortality/feed_bags
-- column-swap correction, and an eggs correction fully corroborated by the
-- page's own section subtotal) — both need the same "never lose the
-- original value" guarantee bird_population already has, so they get their
-- own original-value columns rather than overloading one shared column
-- (which would make it ambiguous which field a stored "original" belonged
-- to when more than one field on the same row gets corrected).
-- auto_correction_note (already text, already nullable) is reused for all
-- three correction kinds — multiple corrections on one row simply append
-- to it, same as flag_reason already does for multiple flag reasons.
-- =============================================================================

BEGIN;

ALTER TABLE daily_production ADD COLUMN mortality_original integer;
ALTER TABLE daily_production ADD COLUMN eggs_total_original integer;

COMMENT ON COLUMN daily_production.mortality_original IS
    'The raw extracted mortality value BEFORE an automatic column-swap correction (see lib/extraction/mortalityFeedSwap.ts and auto_correction_note). NULL unless this row''s mortality was auto-corrected — mortality itself always holds the corrected, saved value.';
COMMENT ON COLUMN daily_production.eggs_total_original IS
    'The raw extracted eggs_total value BEFORE an automatic page-checksum-corroborated correction (see lib/extraction/pageChecksum.ts and auto_correction_note). NULL unless this row''s eggs_total was auto-corrected.';

COMMIT;
