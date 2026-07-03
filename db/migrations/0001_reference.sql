-- =============================================================================
-- Migration 0001: enum types + reference tables (farms, sheds, feed_materials)
-- Source: yash-poultry-farm-schema-spec.md — Table 0 (farms), Table 2 (sheds),
--         Table 6a (feed_materials)
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Enum types (values exactly as listed in the schema spec)
-- ---------------------------------------------------------------------------

CREATE TYPE flock_stage AS ENUM ('chick', 'grower', 'layer');

CREATE TYPE flock_status AS ENUM ('active', 'depleted');

CREATE TYPE shed_type AS ENUM ('chick', 'grower', 'layer');

-- Table 4b: category is AI-classified from the ledger label, never manually
-- selected; low-confidence classifications are flagged for owner review.
CREATE TYPE egg_stock_entry_category AS ENUM (
    'sale',
    'breakage',
    'gift',
    'cross_farm_adjustment',
    'production_addition',
    'other'
);

CREATE TYPE sales_transaction_type AS ENUM (
    'sale_farmfresh',
    'sale_wholesaler',
    'gift',
    'staff_allocation',
    'other'
);

-- ---------------------------------------------------------------------------
-- Table 0: farms
-- Two farms, same owner, operationally separate. Every downstream table
-- carries farm_code so Anil can be onboarded later without a rebuild.
-- ---------------------------------------------------------------------------

CREATE TABLE farms (
    farm_code                  text PRIMARY KEY,          -- 'YPF' / 'APF'
    farm_name                  text NOT NULL,
    layer_capacity             integer NOT NULL CHECK (layer_capacity >= 0),
    chick_grower_capacity      integer NOT NULL CHECK (chick_grower_capacity >= 0),
    total_capacity             integer GENERATED ALWAYS AS
                                   (layer_capacity + chick_grower_capacity) STORED,
    -- Reference figure only, not a hard constraint. Used by the Daily
    -- Production outlier/range checks to spot implausible bird_population.
    typical_filled_layer_count integer
);

-- ---------------------------------------------------------------------------
-- Table 2: sheds (Shed Master — optional but recommended; included)
-- A shed can house more than one flock (different cohort/age) at once.
-- shed_code is unique per farm, hence the composite primary key.
-- ---------------------------------------------------------------------------

CREATE TABLE sheds (
    farm_code    text NOT NULL REFERENCES farms (farm_code),
    shed_code    text NOT NULL,                            -- e.g. 'Shed 4'
    shed_type    shed_type,
    max_capacity integer CHECK (max_capacity >= 0),
    notes        text,
    PRIMARY KEY (farm_code, shed_code)
);

-- ---------------------------------------------------------------------------
-- Table 6a: feed_materials (reference list, 28 materials — seeded)
-- Shared reference list, no farm_code: per-farm separation happens in
-- feed_stock (each farm has its own mill/stock rows). See docs/DECISIONS.md.
-- info/function/notes columns stay null until the Phase 4.5 tooltip feature.
-- ---------------------------------------------------------------------------

CREATE TABLE feed_materials (
    material_name           text PRIMARY KEY,
    info_summary            text,
    function                text,
    excess_deficiency_notes text
);

COMMIT;
