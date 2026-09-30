-- =============================================================================
-- Migration 0018: extraction_corrections (owner request, 2026-10-02) — a
-- growing, periodically-curated library of confirmed extraction
-- corrections. Every confirmed correction (a case where the true value
-- is known for certain — either read by eye directly off the register,
-- or corroborated by the chain/checksum/digit-evidence machinery already
-- in this codebase) is a labeled example of this specific scribe's
-- handwriting. Currently those are used once (to fix one row) and
-- thrown away. This table lets them be logged, periodically reviewed by
-- the owner and Claude together, and the best ones promoted into the
-- extraction prompt's actual few-shot examples (see
-- lib/extraction/fewShotExamples.ts and scripts/promote-correction.ts).
--
-- Deliberately NOT wired into any automatic per-upload process — this is
-- a periodic, human-curated batch step (every 20-30 corrections, or
-- monthly, whichever comes first, per the owner), not something that
-- runs on every extraction. No RLS, matching every other table in this
-- schema (RLS-disabled is a separate, already-deferred finding — not
-- touched here).
-- =============================================================================

BEGIN;

CREATE TABLE extraction_corrections (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    farm_code         text NOT NULL REFERENCES farms(farm_code),
    date              date NOT NULL,
    flock_label       text,
    field_name        text NOT NULL,
    extracted_value   text NOT NULL,
    correct_value     text NOT NULL,
    confidence        text NOT NULL DEFAULT 'corroborated'
                          CHECK (confidence IN ('eye_confirmed', 'corroborated')),
    source_photo_url  text,
    crop_image_url    text,
    note              text,
    status            text NOT NULL DEFAULT 'candidate'
                          CHECK (status IN ('candidate', 'active', 'retired')),
    created_at        timestamptz NOT NULL DEFAULT now(),
    promoted_at       timestamptz
);

COMMENT ON TABLE extraction_corrections IS
    'A growing library of confirmed extraction corrections (true value known for certain), periodically curated by the owner and Claude in conversation and promoted into the live extraction prompt''s few-shot examples. Not read or written by the automatic upload flow.';
COMMENT ON COLUMN extraction_corrections.flock_label IS
    'e.g. ''BAB-4''. NULL for a page-level example not tied to one flock''s row.';
COMMENT ON COLUMN extraction_corrections.field_name IS
    'Which extracted field this correction is about: eggs_total, bird_population, hd_percent_written, mortality, or feed_bags — not constrained by a CHECK since new fields may need this later.';
COMMENT ON COLUMN extraction_corrections.extracted_value IS
    'What the model actually read, as text (covers both integer and decimal fields without a type per field_name).';
COMMENT ON COLUMN extraction_corrections.correct_value IS
    'The confirmed true value, as text, same reasoning as extracted_value.';
COMMENT ON COLUMN extraction_corrections.confidence IS
    'eye_confirmed = the owner read this value directly off the physical register or photo. corroborated = confirmed via chain/checksum/HD math, not read by eye.';
COMMENT ON COLUMN extraction_corrections.crop_image_url IS
    'Populated once this row has been cropped into a usable few-shot image, ahead of or during promotion. NULL until then.';
COMMENT ON COLUMN extraction_corrections.status IS
    'candidate = logged, not yet reviewed. active = currently included in the live extraction prompt''s few-shot set (see lib/extraction/fewShotExamples.data.json). retired = was active, superseded or no longer needed — never deleted, so promotion history stays visible.';
COMMENT ON COLUMN extraction_corrections.promoted_at IS
    'When this row''s status last became active. NULL for a row still at candidate or retired without ever having been promoted.';

COMMIT;
