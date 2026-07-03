-- =============================================================================
-- Migration 0004: daily_egg_stock_summary + daily_egg_stock_entries + sales
-- Source: yash-poultry-farm-schema-spec.md — Tables 4a, 4b, 5
--
-- The paper Egg Stock register is a running ledger, not fixed columns: a top
-- total, a variable list of labeled +/- lines, and a closing balance that
-- carries forward as tomorrow's opening figure. Modeled as header + child
-- ledger rows so a new entry type never breaks the schema.
--
-- sales has NO independent paper source — rows are generated from ledger
-- entries where category = 'sale' (Phase 3 logic). Price is confirmed to have
-- no paper source at all: price_per_unit / amount stay null unless the owner
-- ever enters them manually.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Table 4a: daily_egg_stock_summary (header, one row per farm per day)
-- ---------------------------------------------------------------------------

CREATE TABLE daily_egg_stock_summary (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    date                  date NOT NULL,
    farm_code             text NOT NULL REFERENCES farms (farm_code),
    -- Should match the "Total" figure at top of the ledger on paper, and the
    -- SUM of that date's daily_production.eggs_total (cross-table check in 0006).
    total_eggs_produced   integer CHECK (total_eggs_produced >= 0),
    -- Whole-farm pooled grading, not flock-specific (deliberate addition #1 —
    -- new going forward, may be absent on older pages, hence nullable).
    grade_13_eggs         integer CHECK (grade_13_eggs >= 0),
    grade_14_eggs         integer CHECK (grade_14_eggs >= 0),
    grade_15_eggs         integer CHECK (grade_15_eggs >= 0),
    grade_15plus_eggs     integer CHECK (grade_15plus_eggs >= 0),
    -- Final figure — carries forward as next day's starting point.
    closing_balance_eggs  integer,
    -- Display only, per spec: eggs / 30.
    closing_balance_trays numeric(12, 2) GENERATED ALWAYS AS
                              (round(closing_balance_eggs::numeric / 30, 2)) STORED,
    ocr_confidence        jsonb,
    flagged               boolean NOT NULL DEFAULT false,
    flag_reason           text,
    reviewed_by_owner     boolean NOT NULL DEFAULT false,
    source_photo_url      text,
    UNIQUE (farm_code, date)                    -- one row per farm per day
);

CREATE INDEX idx_egg_stock_summary_flagged ON daily_egg_stock_summary (flagged) WHERE flagged;

-- ---------------------------------------------------------------------------
-- Table 4b: daily_egg_stock_entries (ledger lines, variable count per day)
-- ---------------------------------------------------------------------------

CREATE TABLE daily_egg_stock_entries (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    egg_stock_summary_id  bigint NOT NULL
                              REFERENCES daily_egg_stock_summary (id) ON DELETE CASCADE,
    sequence_order        integer NOT NULL,     -- top-to-bottom as written; balance is cumulative
    label_as_written      text NOT NULL,        -- e.g. 'Anil(-)', 'Sale(-)', 'Birth(+)'
    -- AI-classified from the label, not manually selected. Low-confidence
    -- classifications get flagged into the same owner review queue.
    category              egg_stock_entry_category,
    amount_eggs           integer NOT NULL,     -- signed, as written (+/-)
    -- Calculated by the system (fn_recompute_egg_stock_running_balances),
    -- never read from paper — paper only shows the final balance.
    running_balance_after integer,
    -- Set when category = 'sale' and the matching sales row is generated
    -- (FK added after sales exists — see bottom of this migration).
    linked_sale_id        bigint,
    ocr_confidence        jsonb,
    flagged               boolean NOT NULL DEFAULT false,
    flag_reason           text,
    reviewed_by_owner     boolean NOT NULL DEFAULT false,
    UNIQUE (egg_stock_summary_id, sequence_order)
);

CREATE INDEX idx_egg_stock_entries_summary ON daily_egg_stock_entries (egg_stock_summary_id);
CREATE INDEX idx_egg_stock_entries_flagged ON daily_egg_stock_entries (flagged) WHERE flagged;

-- ---------------------------------------------------------------------------
-- Table 5: sales — derived, populated from ledger entries (category = 'sale')
-- ---------------------------------------------------------------------------

CREATE TABLE sales (
    id                     bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    date                   date NOT NULL,
    farm_code              text NOT NULL REFERENCES farms (farm_code),
    -- The ledger line this row was derived from.
    source_ledger_entry_id bigint REFERENCES daily_egg_stock_entries (id),
    transaction_type       sales_transaction_type,
    -- Buyer name or staff name (e.g. 'Sukha', 'Neel', 'Ashok') as written on
    -- the ledger label.
    buyer_or_recipient     text,
    grade                  text,                -- size grade sold, if applicable
    eggs_quantity          integer CHECK (eggs_quantity >= 0),  -- abs(amount_eggs) of source entry
    trays_quantity         numeric(12, 2) GENERATED ALWAYS AS
                               (round(eggs_quantity::numeric / 30, 2)) STORED,
    price_per_unit         numeric(12, 2),      -- no paper source — manual entry only, if ever
    amount                 numeric(14, 2),      -- no paper source — manual entry only, if ever
    -- Only if a second breakage checkpoint is ever separately recorded; not
    -- currently confirmed as its own paper figure.
    breakage_sale_eggs     integer CHECK (breakage_sale_eggs >= 0)
);

CREATE INDEX idx_sales_farm_date ON sales (farm_code, date);

-- Close the deliberate circular reference: ledger entry -> generated sale.
ALTER TABLE daily_egg_stock_entries
    ADD CONSTRAINT fk_egg_stock_entries_linked_sale
    FOREIGN KEY (linked_sale_id) REFERENCES sales (id);

COMMIT;
