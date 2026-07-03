-- =============================================================================
-- Migration 0003: daily_production
-- Source: yash-poultry-farm-schema-spec.md — Table 3
--
-- One row per flock, per day. Mirrors the paper production register exactly
-- (header "Mort, Feed | I | II | Total | Bal Bird | %"; the I/II columns are
-- confirmed not meaningfully used and have no schema field).
--
-- Data columns are nullable on purpose: a blank field in the photo is a FLAG
-- condition (record saved with flagged = true), never an insert rejection.
-- The flag-for-review rules live in fn_validate_daily_production (0006).
-- =============================================================================

BEGIN;

CREATE TABLE daily_production (
    id                       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    date                     date NOT NULL,
    farm_code                text NOT NULL REFERENCES farms (farm_code),
    -- Resolved from display_label + date via resolve_flock_internal_id().
    flock_internal_id        uuid NOT NULL REFERENCES flocks (flock_internal_id),
    display_label_as_written text,               -- raw OCR value, audit trail
    shed_code                text,               -- as written that day (raw, not FK)
    mortality                integer CHECK (mortality >= 0),          -- day's-end total, not cumulative
    feed_bags                integer CHECK (feed_bags >= 0),          -- 1 bag = 45 kg
    eggs_total               integer CHECK (eggs_total >= 0),         -- "Total" column
    bird_population          integer CHECK (bird_population >= 0),    -- "Bal Bird"
    hd_percent               numeric(5, 2),      -- "%" column; cross-checked against eggs/birds
    ocr_confidence           jsonb,              -- per-field confidence scores
    flagged                  boolean NOT NULL DEFAULT false,
    flag_reason              text,
    reviewed_by_owner        boolean NOT NULL DEFAULT false,
    source_photo_url         text,
    UNIQUE (flock_internal_id, date)             -- one row per flock per day
);

CREATE INDEX idx_daily_production_farm_date ON daily_production (farm_code, date);
CREATE INDEX idx_daily_production_flagged ON daily_production (flagged) WHERE flagged;

COMMIT;
