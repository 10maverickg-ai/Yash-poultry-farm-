-- =============================================================================
-- Migration 0008: daily_feed_bag_stock (owner-supplied addition, 2026-07-10)
--
-- A second Feed Stock register, kept separate from Table 6 (feed_stock,
-- mill-level raw-material quintal/kg tracking). This one tracks made-up FEED
-- BAGS by flock group (the paper page shows two groups side by side, e.g.
-- "Layer (BAB 1-7)" and "Grower (BAB 8-10)") — opening/produced/total/
-- consumed bag counts, plus where unconsumed bags currently sit: still at
-- the mill ("F") or already moved to shed ("S").
--
-- Design note flagged for the owner: the cross-table validation rule
-- ("consumed_bags should equal SUM(daily_production.feed_bags) for flocks
-- belonging to that group") requires knowing which flocks belong to a group
-- on a given date. Group membership isn't derivable from any existing
-- column — flock_group here is free text like feed_formulation's
-- formulation_group, not FK'd to flocks, and BAB-number ranges shift under
-- renumbering exactly like shed assignment does. Rather than parse the
-- group label or trust a mutable "current group" field (which would give
-- the wrong answer for past dates after a later regrouping), membership is
-- captured explicitly per entry via daily_feed_bag_stock_flocks, the same
-- philosophy as daily_production.shed_code being stored per-row instead of
-- read live off flocks.current_shed. This is an interpretation, not a
-- literal spec instruction — flag if a different mechanism was intended.
-- =============================================================================

BEGIN;

CREATE TABLE daily_feed_bag_stock (
    id                    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    date                  date NOT NULL,
    farm_code             text NOT NULL REFERENCES farms (farm_code),
    -- e.g. "Layer (BAB 1-7)", "Grower (BAB 8-10)" — free text, the two
    -- groups the register currently shows side by side; may evolve.
    flock_group           text NOT NULL,
    opening_balance_bags  integer CHECK (opening_balance_bags >= 0),   -- yesterday's closing
    produced_bags         integer CHECK (produced_bags >= 0),          -- new bags mixed that day
    total_bags            integer CHECK (total_bags >= 0),             -- as written; should = opening + produced
    consumed_bags         integer CHECK (consumed_bags >= 0),          -- bags used by the group that day
    mill_inventory_bags   integer CHECK (mill_inventory_bags >= 0),    -- "F" — unconsumed, still at the mill
    shed_inventory_bags   integer CHECK (shed_inventory_bags >= 0),    -- "S" — unconsumed, moved to shed
    closing_balance_bags  integer CHECK (closing_balance_bags >= 0),   -- as written; should = mill + shed
    ocr_confidence        jsonb,
    flagged               boolean NOT NULL DEFAULT false,
    flag_reason           text,
    reviewed_by_owner     boolean NOT NULL DEFAULT false,
    source_photo_url      text,
    UNIQUE (farm_code, flock_group, date)      -- one row per group per day
);

CREATE INDEX idx_feed_bag_stock_farm_date ON daily_feed_bag_stock (farm_code, date);
CREATE INDEX idx_feed_bag_stock_flagged ON daily_feed_bag_stock (flagged) WHERE flagged;

-- Which flocks this group's row covers, captured explicitly per entry (see
-- design note above) — drives the consumed_bags cross-check.
CREATE TABLE daily_feed_bag_stock_flocks (
    feed_bag_stock_id bigint NOT NULL REFERENCES daily_feed_bag_stock (id) ON DELETE CASCADE,
    flock_internal_id uuid NOT NULL REFERENCES flocks (flock_internal_id),
    PRIMARY KEY (feed_bag_stock_id, flock_internal_id)
);

-- ---------------------------------------------------------------------------
-- Flag-for-review rules, same hybrid pattern as migration 0006/0007:
--   1. missing field (blank in photo) — general flag trigger, all registers
--   2. closing_balance_bags ≠ mill_inventory_bags + shed_inventory_bags
--      (internal consistency)
--   3. total_bags − consumed_bags ≠ closing_balance_bags (core register math)
--   4. consumed_bags ≠ SUM(daily_production.feed_bags) for linked flocks on
--      that date (cross-table check, same pattern as the egg-total check).
--      Skipped (not flagged) when no flocks are linked yet — that's an
--      incomplete entry, not a proven mismatch.
-- ---------------------------------------------------------------------------

CREATE FUNCTION fn_validate_feed_bag_stock(p_id bigint)
RETURNS text[]
LANGUAGE plpgsql STABLE AS $$
DECLARE
    r                 daily_feed_bag_stock%ROWTYPE;
    reasons           text[] := '{}';
    v_linked_feed_sum integer;
    v_linked_count    integer;
BEGIN
    SELECT * INTO r FROM daily_feed_bag_stock WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'daily_feed_bag_stock id % not found', p_id;
    END IF;

    IF r.opening_balance_bags IS NULL THEN reasons := reasons || 'missing field: opening_balance_bags'::text; END IF;
    IF r.produced_bags IS NULL THEN reasons := reasons || 'missing field: produced_bags'::text; END IF;
    IF r.total_bags IS NULL THEN reasons := reasons || 'missing field: total_bags'::text; END IF;
    IF r.consumed_bags IS NULL THEN reasons := reasons || 'missing field: consumed_bags'::text; END IF;
    IF r.mill_inventory_bags IS NULL THEN reasons := reasons || 'missing field: mill_inventory_bags'::text; END IF;
    IF r.shed_inventory_bags IS NULL THEN reasons := reasons || 'missing field: shed_inventory_bags'::text; END IF;
    IF r.closing_balance_bags IS NULL THEN reasons := reasons || 'missing field: closing_balance_bags'::text; END IF;

    IF r.closing_balance_bags IS NOT NULL AND r.mill_inventory_bags IS NOT NULL
       AND r.shed_inventory_bags IS NOT NULL
       AND r.closing_balance_bags <> r.mill_inventory_bags + r.shed_inventory_bags THEN
        reasons := reasons || format(
            'closing balance mismatch: closing %s bags, but mill (F) %s + shed (S) %s = %s bags',
            r.closing_balance_bags, r.mill_inventory_bags, r.shed_inventory_bags,
            r.mill_inventory_bags + r.shed_inventory_bags);
    END IF;

    IF r.total_bags IS NOT NULL AND r.consumed_bags IS NOT NULL AND r.closing_balance_bags IS NOT NULL
       AND r.total_bags - r.consumed_bags <> r.closing_balance_bags THEN
        reasons := reasons || format(
            'bag arithmetic mismatch: total %s − consumed %s = %s, but closing is %s bags',
            r.total_bags, r.consumed_bags, r.total_bags - r.consumed_bags, r.closing_balance_bags);
    END IF;

    IF r.consumed_bags IS NOT NULL THEN
        SELECT sum(dp.feed_bags), count(*) INTO v_linked_feed_sum, v_linked_count
          FROM daily_feed_bag_stock_flocks link
          JOIN daily_production dp
            ON dp.flock_internal_id = link.flock_internal_id AND dp.date = r.date
         WHERE link.feed_bag_stock_id = r.id;
        IF v_linked_count > 0 AND v_linked_feed_sum IS NOT NULL
           AND v_linked_feed_sum <> r.consumed_bags THEN
            reasons := reasons || format(
                'consumed_bags %s does not match sum of linked flocks'' feed_bags %s for %s',
                r.consumed_bags, v_linked_feed_sum, r.date);
        END IF;
    END IF;

    RETURN reasons;
END;
$$;

COMMIT;
