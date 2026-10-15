-- =============================================================================
-- Migration 0022: bv300_standard_laying — 3 more columns from the same guide
--
-- Backfilled into this repo, 2026-10-15 — already applied directly against
-- the live Supabase project (migration "bv300_laying_extra_columns", version
-- 20261015080229), same situation as migration 0021's header explains.
--
-- Schema only. The reference VALUES for these 3 new columns (same BV300
-- guide as db/seeds/0003_bv300_standards.sql, same guide_version='2023') are
-- static reference data, not operational register data, so — unlike
-- 0021 — they belong in a seed file: see db/seeds/0004_bv300_laying_extra_columns.sql.
-- =============================================================================

BEGIN;

ALTER TABLE bv300_standard_laying
    -- "Current" feed-per-egg at this age (distinct from the existing
    -- feed_per_egg_g, which is the headline table's own column from
    -- migration 0007) — a second feed-efficiency figure the guide states
    -- separately; kept as its own column rather than overloading the
    -- existing one, since the two are not stated to be the same number.
    ADD COLUMN current_feed_per_egg_g numeric,
    -- Current hen-housed-production mortality % and cumulative hen-housed
    -- eggs at this age — both from the same guide table as
    -- cumulative_depletion_percent, giving Phase 4's dashboard the data to
    -- compare a flock's actual cumulative eggs/HHP against the standard at
    -- its own age, not just depletion.
    ADD COLUMN cur_hhp_percent numeric,
    ADD COLUMN cum_hhp_eggs integer;

COMMIT;
