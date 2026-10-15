-- =============================================================================
-- Migration 0023: daily_egg_rates
--
-- Backfilled into this repo, 2026-10-15 — already applied directly against
-- the live Supabase project (migration "daily_egg_rates", version
-- 20261015085516), same situation as migrations 0021/0022's headers explain.
-- Schema only; the real historical rate data (Aug 1-31) is operational data
-- and intentionally not reproduced here — see migration 0021's header for
-- why.
--
-- One row per day: the BAFTA market rate as pasted/photographed from the
-- owner's daily rate message, plus this farm's own big/small egg rates
-- derived from it (big_rate = bafta_rate - 0.03, small_rate = bafta_rate -
-- 0.25, per the owner). A day with no new rate reuses the previous day's —
-- that's app logic (Phase 2), not a database default, since "reuse" needs to
-- know it's reusing, not just silently carry a value forward.
-- =============================================================================

BEGIN;

CREATE TABLE daily_egg_rates (
    date       date PRIMARY KEY,
    bafta_rate numeric NOT NULL,
    big_rate   numeric,
    small_rate numeric,
    source     text DEFAULT 'handwritten rate list',
    note       text,
    created_at timestamptz DEFAULT now()
);

COMMIT;
