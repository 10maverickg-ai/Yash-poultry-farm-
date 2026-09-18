-- =============================================================================
-- Migration 0010: daily_production extraction diagnostics (2026-09-18)
--
-- These were previously only console.log'd on the server (visible in
-- Vercel's function logs), which the owner cannot reliably reach from the
-- mobile interface. Stored per-row here instead, following the same
-- denormalized pattern already used for source_photo_url: sections_found
-- and page_notes are properties of the whole photo/extraction call, not of
-- any one flock, so every flock row written from the same upload carries
-- the same values — redundant, but it means the owner can see them
-- directly on any row in /flagged or Supabase's Table Editor with no join
-- and no log access at all.
-- =============================================================================

BEGIN;

ALTER TABLE daily_production
    ADD COLUMN sections_found integer,
    ADD COLUMN page_notes     text;

COMMENT ON COLUMN daily_production.sections_found IS
    'Model''s self-reported count of distinct flock-table blocks found anywhere in the source photo. A page with a two-table split (see DECISIONS.md, Phase 3 increment 2) should report 2 — if it reports 1 and flocks are still missing from the other table, the model never saw the second section at all; if it reports 2 and flocks are still missing, extraction found both but something downstream dropped one. Null for rows entered manually or extracted before this column existed.';

COMMENT ON COLUMN daily_production.page_notes IS
    'Model''s free-text notes from the extraction call that produced this row (illegible sections, other registers visible on the page, etc). Same value across every flock row from one upload.';

COMMIT;
