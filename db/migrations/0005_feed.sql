-- =============================================================================
-- Migration 0005: feed_stock + feed_formulation
-- Source: yash-poultry-farm-schema-spec.md — Tables 6, 7
--
-- feed_stock: one row per raw material, per day, at MILL level — not
-- flock-level. Formulation varies per flock, so mill-level consumption can't
-- be validated against individual flock feed_bags automatically (explicitly
-- out of scope).
--
-- All quantities stored normalized to kg. On paper, opening/purchase/closing
-- are in quintals (×100 at extraction time) while consumed is written in kg
-- directly — that confirmed same-page unit inconsistency is exactly why the
-- balance validation rule exists.
-- =============================================================================

BEGIN;

CREATE TABLE feed_stock (
    id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    date               date NOT NULL,
    farm_code          text NOT NULL REFERENCES farms (farm_code),  -- each farm has its own mill/stock
    material_name      text NOT NULL REFERENCES feed_materials (material_name),
    opening_balance_kg numeric(12, 3) CHECK (opening_balance_kg >= 0),
    purchase_kg        numeric(12, 3) CHECK (purchase_kg >= 0),
    consumed_kg        numeric(12, 3) CHECK (consumed_kg >= 0),
    closing_balance_kg numeric(12, 3) CHECK (closing_balance_kg >= 0),
    ocr_confidence     jsonb,
    flagged            boolean NOT NULL DEFAULT false,
    flag_reason        text,
    reviewed_by_owner  boolean NOT NULL DEFAULT false,
    source_photo_url   text,
    UNIQUE (farm_code, material_name, date)     -- one row per material per day
);

CREATE INDEX idx_feed_stock_farm_date ON feed_stock (farm_code, date);
CREATE INDEX idx_feed_stock_flagged ON feed_stock (flagged) WHERE flagged;

-- ---------------------------------------------------------------------------
-- Table 7: feed_formulation — versioned reference, not daily data.
-- Recipe changes by GROUP ('Flock 7', 'Flocks 1-6', 'Flock 8' currently, but
-- the grouping itself may change), so formulation_group is a free-text label,
-- deliberately NOT an FK to flocks. Likely owner-entered rather than OCR'd.
-- This is what lets the Phase 4 dashboard overlay formulation changes on the
-- production timeline.
-- ---------------------------------------------------------------------------

CREATE TABLE feed_formulation (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    effective_date    date NOT NULL,
    farm_code         text NOT NULL REFERENCES farms (farm_code),
    formulation_group text NOT NULL,            -- e.g. 'Flock 7', 'Flocks 1-6' — may evolve
    material_name     text NOT NULL REFERENCES feed_materials (material_name),
    quantity_kg       numeric(12, 3) CHECK (quantity_kg >= 0),   -- per batch
    batch_total_kg    numeric(12, 3) CHECK (batch_total_kg >= 0),-- total batch weight for the group
    reason_for_change text,                     -- e.g. 'shell quality issue — increased calcium'
    source_photo_url  text,
    -- One quantity per material per group per version date.
    UNIQUE (farm_code, formulation_group, effective_date, material_name)
);

CREATE INDEX idx_feed_formulation_group
    ON feed_formulation (farm_code, formulation_group, effective_date);

COMMIT;
