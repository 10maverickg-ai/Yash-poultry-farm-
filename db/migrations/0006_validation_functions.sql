-- =============================================================================
-- Migration 0006: flag-for-review validation functions
--
-- These implement the schema spec's auto-flag rules as application-layer
-- checks that happen to live in the database (owner chose hybrid enforcement —
-- see docs/VALIDATION.md). They are deliberately NOT constraints or triggers:
-- a violating record must still be SAVED with flagged = true and routed to the
-- owner's review queue, never rejected. Phase 2 entry screens (and later the
-- Phase 3 extraction pipeline) call these after writing a row.
--
-- Each fn_validate_* returns an array of human-readable flag reasons
-- (empty array = record passes all checks). Callers set:
--     flagged     = (array_length(reasons, 1) IS NOT NULL)
--     flag_reason = array_to_string(reasons, '; ')
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Table 3: daily_production validation
--   1. hd_percent recalculated ≠ stored value (rounding tolerance ±0.2%)
--   2. mortality > 3× that flock's trailing 7-day average (real event, not
--      necessarily an error, but worth eyes)
--   3. bird_population increased day-over-day (should only decrease via
--      mortality; the schema has no transfer/placement event log yet, so ANY
--      increase is surfaced for review)
--   4. missing field (blank in photo)
-- ---------------------------------------------------------------------------

CREATE FUNCTION fn_validate_daily_production(p_id bigint)
RETURNS text[]
LANGUAGE plpgsql STABLE AS $$
DECLARE
    r               daily_production%ROWTYPE;
    reasons         text[] := '{}';
    v_calc_hd       numeric;
    v_trailing_avg  numeric;
    v_prev_bird_pop integer;
BEGIN
    SELECT * INTO r FROM daily_production WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'daily_production id % not found', p_id;
    END IF;

    -- Rule 4: missing fields
    IF r.mortality IS NULL THEN reasons := reasons || 'missing field: mortality'::text; END IF;
    IF r.feed_bags IS NULL THEN reasons := reasons || 'missing field: feed_bags'::text; END IF;
    IF r.eggs_total IS NULL THEN reasons := reasons || 'missing field: eggs_total'::text; END IF;
    IF r.bird_population IS NULL THEN reasons := reasons || 'missing field: bird_population'::text; END IF;
    IF r.hd_percent IS NULL THEN reasons := reasons || 'missing field: hd_percent'::text; END IF;

    -- Rule 1: HD% cross-check, tolerance ±0.2 percentage points
    IF r.eggs_total IS NOT NULL AND r.bird_population IS NOT NULL
       AND r.bird_population > 0 AND r.hd_percent IS NOT NULL THEN
        v_calc_hd := round(r.eggs_total::numeric / r.bird_population * 100, 2);
        IF abs(v_calc_hd - r.hd_percent) > 0.2 THEN
            reasons := reasons || format(
                'HD%% mismatch: written %s%%, calculated %s%%', r.hd_percent, v_calc_hd);
        END IF;
    END IF;

    -- Rule 2: mortality outlier vs trailing 7-day average for this flock
    IF r.mortality IS NOT NULL THEN
        SELECT avg(dp.mortality) INTO v_trailing_avg
          FROM daily_production dp
         WHERE dp.flock_internal_id = r.flock_internal_id
           AND dp.date >= r.date - 7 AND dp.date < r.date
           AND dp.mortality IS NOT NULL;
        IF v_trailing_avg IS NOT NULL AND r.mortality > 3 * v_trailing_avg THEN
            reasons := reasons || format(
                'mortality outlier: %s vs trailing 7-day average %s',
                r.mortality, round(v_trailing_avg, 1));
        END IF;
    END IF;

    -- Rule 3: bird_population increased day-over-day
    IF r.bird_population IS NOT NULL THEN
        SELECT dp.bird_population INTO v_prev_bird_pop
          FROM daily_production dp
         WHERE dp.flock_internal_id = r.flock_internal_id
           AND dp.date < r.date
           AND dp.bird_population IS NOT NULL
         ORDER BY dp.date DESC
         LIMIT 1;
        IF v_prev_bird_pop IS NOT NULL AND r.bird_population > v_prev_bird_pop THEN
            reasons := reasons || format(
                'bird_population increased: %s from %s on previous entry',
                r.bird_population, v_prev_bird_pop);
        END IF;
    END IF;

    RETURN reasons;
END;
$$;

-- ---------------------------------------------------------------------------
-- Tables 4a/4b: egg stock ledger validation
--   1. closing_balance_eggs ≠ total_eggs_produced + SUM(entries.amount_eggs)
--   2. last running_balance_after in the ledger ≠ closing_balance_eggs
--   3. total_eggs_produced ≠ SUM of that date's daily_production.eggs_total
--      (cross-table consistency check; only runs once production rows exist)
--   plus missing-field checks on the two figures every ledger page carries.
--   (Grading counts are NOT treated as missing fields — they're a new
--   addition and may legitimately be absent on older pages.)
-- ---------------------------------------------------------------------------

CREATE FUNCTION fn_validate_egg_stock_summary(p_id bigint)
RETURNS text[]
LANGUAGE plpgsql STABLE AS $$
DECLARE
    s                daily_egg_stock_summary%ROWTYPE;
    reasons          text[] := '{}';
    v_entries_sum    integer;
    v_entries_count  integer;
    v_last_balance   integer;
    v_production_sum integer;
BEGIN
    SELECT * INTO s FROM daily_egg_stock_summary WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'daily_egg_stock_summary id % not found', p_id;
    END IF;

    IF s.total_eggs_produced IS NULL THEN
        reasons := reasons || 'missing field: total_eggs_produced'::text;
    END IF;
    IF s.closing_balance_eggs IS NULL THEN
        reasons := reasons || 'missing field: closing_balance_eggs'::text;
    END IF;

    SELECT coalesce(sum(e.amount_eggs), 0), count(*)
      INTO v_entries_sum, v_entries_count
      FROM daily_egg_stock_entries e
     WHERE e.egg_stock_summary_id = s.id;

    -- Rule 1: closing balance must equal top total plus all signed ledger lines
    IF s.total_eggs_produced IS NOT NULL AND s.closing_balance_eggs IS NOT NULL
       AND s.closing_balance_eggs <> s.total_eggs_produced + v_entries_sum THEN
        reasons := reasons || format(
            'ledger balance mismatch: closing %s, but total %s + entries sum %s = %s',
            s.closing_balance_eggs, s.total_eggs_produced, v_entries_sum,
            s.total_eggs_produced + v_entries_sum);
    END IF;

    -- Rule 2: last running balance must land on the closing figure
    IF v_entries_count > 0 AND s.closing_balance_eggs IS NOT NULL THEN
        SELECT e.running_balance_after INTO v_last_balance
          FROM daily_egg_stock_entries e
         WHERE e.egg_stock_summary_id = s.id
         ORDER BY e.sequence_order DESC
         LIMIT 1;
        IF v_last_balance IS NOT NULL AND v_last_balance <> s.closing_balance_eggs THEN
            reasons := reasons || format(
                'last running balance %s does not match closing balance %s',
                v_last_balance, s.closing_balance_eggs);
        END IF;
    END IF;

    -- Rule 3: cross-table check against Daily Production
    SELECT sum(dp.eggs_total) INTO v_production_sum
      FROM daily_production dp
     WHERE dp.farm_code = s.farm_code AND dp.date = s.date;
    IF v_production_sum IS NOT NULL AND s.total_eggs_produced IS NOT NULL
       AND s.total_eggs_produced <> v_production_sum THEN
        reasons := reasons || format(
            'total_eggs_produced %s does not match daily_production sum %s for %s',
            s.total_eggs_produced, v_production_sum, s.date);
    END IF;

    RETURN reasons;
END;
$$;

-- ---------------------------------------------------------------------------
-- Running balances are calculated by the system, never read from paper
-- (paper doesn't always show intermediate balances, only the final one).
-- Starts from the header's total_eggs_produced and applies each signed line
-- in sequence_order.
-- ---------------------------------------------------------------------------

CREATE FUNCTION fn_recompute_egg_stock_running_balances(p_summary_id bigint)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_balance integer;
    v_entry   record;
BEGIN
    SELECT total_eggs_produced INTO v_balance
      FROM daily_egg_stock_summary WHERE id = p_summary_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'daily_egg_stock_summary id % not found', p_summary_id;
    END IF;

    FOR v_entry IN
        SELECT id, amount_eggs
          FROM daily_egg_stock_entries
         WHERE egg_stock_summary_id = p_summary_id
         ORDER BY sequence_order
    LOOP
        v_balance := v_balance + v_entry.amount_eggs;
        UPDATE daily_egg_stock_entries
           SET running_balance_after = v_balance
         WHERE id = v_entry.id;
    END LOOP;
END;
$$;

-- ---------------------------------------------------------------------------
-- Table 6: feed_stock validation
--   closing_balance_kg ≠ opening_balance_kg + purchase_kg − consumed_kg
--   This is exactly the check that would have caught the quintal/kg unit
--   mismatch found during schema design — built in from day one.
--   A blank purchase column is treated as 0 (no purchase that day), not as a
--   missing field — see docs/DECISIONS.md.
-- ---------------------------------------------------------------------------

CREATE FUNCTION fn_validate_feed_stock(p_id bigint)
RETURNS text[]
LANGUAGE plpgsql STABLE AS $$
DECLARE
    r          feed_stock%ROWTYPE;
    reasons    text[] := '{}';
    v_expected numeric;
BEGIN
    SELECT * INTO r FROM feed_stock WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'feed_stock id % not found', p_id;
    END IF;

    IF r.opening_balance_kg IS NULL THEN reasons := reasons || 'missing field: opening_balance_kg'::text; END IF;
    IF r.consumed_kg IS NULL THEN reasons := reasons || 'missing field: consumed_kg'::text; END IF;
    IF r.closing_balance_kg IS NULL THEN reasons := reasons || 'missing field: closing_balance_kg'::text; END IF;

    IF r.opening_balance_kg IS NOT NULL AND r.consumed_kg IS NOT NULL
       AND r.closing_balance_kg IS NOT NULL THEN
        v_expected := r.opening_balance_kg + coalesce(r.purchase_kg, 0) - r.consumed_kg;
        IF abs(r.closing_balance_kg - v_expected) > 0.001 THEN
            reasons := reasons || format(
                'feed balance mismatch: closing %s kg, but %s + %s − %s = %s kg',
                r.closing_balance_kg, r.opening_balance_kg,
                coalesce(r.purchase_kg, 0), r.consumed_kg, v_expected);
        END IF;
    END IF;

    RETURN reasons;
END;
$$;

COMMIT;
