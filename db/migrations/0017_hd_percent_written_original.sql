-- =============================================================================
-- Migration 0017: hd_percent_written digit-accuracy audit trail (owner
-- request, 2026-10-01 — BAB-4, 2026-08-01: hd_percent_written extracted
-- as 88.10, register actually reads 83.1; eggs_total, bird_population,
-- mortality, and feed_bags on that row were all independently confirmed
-- correct — only this one field was misread)
--
-- Same "never lose the original value" pattern as
-- mortality_original/eggs_total_original/bird_population_original
-- (migrations 0015/0016): a fourth, independent auto-correctable field on
-- the same row, so it gets its own original-value column rather than
-- overloading one shared column across four different fields.
-- auto_correction_note (already text, already nullable) is reused again —
-- multiple corrections on one row simply append to it, unchanged.
--
-- hd_percent_written is reference-only (the register's own written "%"
-- figure); it never feeds hd_percent, the GENERATED, analytics-facing
-- column, which is why this correction can use a lighter-touch rule than
-- the other three fields — see lib/extraction/writtenHdCheck.ts.
-- =============================================================================

BEGIN;

ALTER TABLE daily_production ADD COLUMN hd_percent_written_original numeric(5, 2);

COMMENT ON COLUMN daily_production.hd_percent_written_original IS
    'The raw extracted hd_percent_written value BEFORE an automatic digit-accuracy correction (see lib/extraction/writtenHdCheck.ts and auto_correction_note). NULL unless this row''s hd_percent_written was auto-corrected — hd_percent_written itself always holds the corrected, saved value. Reference-only field; never affects hd_percent, the GENERATED column.';

COMMIT;
