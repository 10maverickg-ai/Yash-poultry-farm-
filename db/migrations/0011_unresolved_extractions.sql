-- =============================================================================
-- Migration 0011: unresolved_extractions + fuzzy label matching (2026-09-18)
--
-- Root design change: previously, if an extracted flock label didn't match
-- flock_label_history EXACTLY (same case, same spacing, same punctuation),
-- the row was silently discarded — the raw numbers only ever existed in an
-- ephemeral UI response, gone the moment the owner navigated away. The Aug 1
-- test showed this happening for all 10 flocks on a real page, which is
-- exactly the kind of day-to-day handwriting/formatting variation this
-- system needs to be resilient to, not treat as a hard failure.
--
-- The match itself is now forgiving of COSMETIC formatting differences
-- (case, spacing, hyphen vs space vs nothing, leading zeros) — see
-- lib/extraction/flockMatch.ts. It deliberately does NOT do edit-distance
-- "close enough" matching on the identifying digits themselves: this farm's
-- own labels (BAB-1 .. BAB-10) differ from each other by exactly one
-- character, so anything looser than exact-on-the-normalized-form would
-- risk silently filing one flock's numbers under a different real flock's
-- identity — a worse outcome than leaving the row for manual review.
--
-- When even normalized matching fails, the row's raw numbers are no longer
-- discarded — they land here instead, with the exact as-written label, so
-- the owner can see them and manually point them at the right flock from
-- /flagged (see resolveExtraction in app/flagged/actions.ts, which then
-- writes a normal daily_production row from this data).
-- =============================================================================

BEGIN;

CREATE TABLE unresolved_extractions (
    id                         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    farm_code                  text NOT NULL REFERENCES farms (farm_code),
    -- Only 'daily_production' is written today; kept as a text discriminator
    -- (not an enum) so Egg Stock Ledger / Feed Bag Stock extraction can use
    -- the same holding table later without a migration.
    register_type              text NOT NULL DEFAULT 'daily_production',
    date                       date NOT NULL,
    display_label_as_written   text NOT NULL,
    shed_code                  text,
    mortality                  integer,
    feed_bags                  integer,
    eggs_total                 integer,
    bird_population            integer,
    hd_percent                 numeric(5, 2),
    ocr_confidence             jsonb,
    source_photo_url           text,
    sections_found             integer,
    page_notes                 text,
    created_at                 timestamptz NOT NULL DEFAULT now(),
    -- Set once the owner manually matches this row to a flock. Kept as an
    -- audit record rather than deleted, same spirit as reviewed_by_owner
    -- elsewhere in this schema.
    resolved_at                timestamptz,
    resolved_flock_internal_id uuid REFERENCES flocks (flock_internal_id)
);

CREATE INDEX idx_unresolved_extractions_pending
    ON unresolved_extractions (farm_code, date)
    WHERE resolved_at IS NULL;

COMMIT;
