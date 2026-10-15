-- =============================================================================
-- Migration 0024: fn_validate_feed_bag_stock — tolerate the supervisor's
-- every-two-days feed box recording (owner confirmed, 2026-10-16)
--
-- Check 5 (migration 0020) flags opening_balance_bags whenever it doesn't
-- equal the previous day's closing_balance_bags for the same flock_group.
-- The owner has now confirmed this is a real, ongoing supervisor habit, not
-- a misread: the feed box is sometimes only physically re-counted and
-- re-written every TWO days rather than daily, so the written opening
-- genuinely doesn't chain from the immediately preceding day's closing on
-- those days — there's no reliable arithmetic relationship to check during
-- a gap like this (confirmed directly against the real Aug 2026 data: the
-- two days already flagged with this exact explanation, 2026-08-06 and
-- 2026-08-09, don't even match TWO days back either — the supervisor
-- simply re-establishes a fresh count, not a carried-forward figure).
-- The owner says this stops in November 2026, so Check 5 is suppressed
-- entirely for dates before 2026-11-01 and resumes at full strength from
-- then — a real mismatch on or after that date is still exactly as wrong
-- as it always was.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_validate_feed_bag_stock(p_id bigint)
RETURNS text[]
LANGUAGE plpgsql STABLE AS $$
DECLARE
    r                 daily_feed_bag_stock%ROWTYPE;
    reasons           text[] := '{}';
    v_linked_feed_sum integer;
    v_linked_count    integer;
    v_prev_closing    integer;
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

    -- Check 1: OB + produced = total line. Unchanged — a genuine arithmetic
    -- slip here (e.g. the confirmed 2026-08-11 case, 143+132<>264) is still
    -- worth a flag in general; that SPECIFIC row was individually marked
    -- reviewed_by_owner once the owner confirmed it, not exempted here,
    -- since this check otherwise stays valuable for catching real misreads.
    IF r.opening_balance_bags IS NOT NULL AND r.produced_bags IS NOT NULL
       AND r.total_bags IS NOT NULL
       AND r.opening_balance_bags + r.produced_bags <> r.total_bags THEN
        reasons := reasons || format(
            'opening %s + produced %s = %s, but total reads %s',
            r.opening_balance_bags, r.produced_bags,
            r.opening_balance_bags + r.produced_bags, r.total_bags);
    END IF;

    -- Check 2: total − closing = consumed.
    IF r.total_bags IS NOT NULL AND r.consumed_bags IS NOT NULL AND r.closing_balance_bags IS NOT NULL
       AND r.total_bags - r.consumed_bags <> r.closing_balance_bags THEN
        reasons := reasons || format(
            'bag arithmetic mismatch: total %s − consumed %s = %s, but closing is %s bags',
            r.total_bags, r.consumed_bags, r.total_bags - r.consumed_bags, r.closing_balance_bags);
    END IF;

    -- Check 3: F + S = closing.
    IF r.closing_balance_bags IS NOT NULL AND r.mill_inventory_bags IS NOT NULL
       AND r.shed_inventory_bags IS NOT NULL
       AND r.closing_balance_bags <> r.mill_inventory_bags + r.shed_inventory_bags THEN
        reasons := reasons || format(
            'closing balance mismatch: closing %s bags, but mill (F) %s + shed (S) %s = %s bags',
            r.closing_balance_bags, r.mill_inventory_bags, r.shed_inventory_bags,
            r.mill_inventory_bags + r.shed_inventory_bags);
    END IF;

    -- Check 4: consumed vs linked flocks' feed_bags sum — worded to point at
    -- neither side (owner's explicit instruction: the cause could be either).
    IF r.consumed_bags IS NOT NULL THEN
        SELECT sum(dp.feed_bags), count(*) INTO v_linked_feed_sum, v_linked_count
          FROM daily_feed_bag_stock_flocks link
          JOIN daily_production dp
            ON dp.flock_internal_id = link.flock_internal_id AND dp.date = r.date
           AND dp.deleted_at IS NULL
         WHERE link.feed_bag_stock_id = r.id;
        IF v_linked_count > 0 AND v_linked_feed_sum IS NOT NULL
           AND v_linked_feed_sum <> r.consumed_bags THEN
            reasons := reasons || format(
                'ledger and flock rows disagree by %s: consumed_bags %s vs sum of linked flocks'' feed_bags %s for %s',
                abs(r.consumed_bags - v_linked_feed_sum), r.consumed_bags, v_linked_feed_sum, r.date);
        END IF;
    END IF;

    -- Check 5: OB equals the previous day's closing for the SAME
    -- flock_group. Suppressed entirely before 2026-11-01 (see this
    -- migration's header) — the supervisor's every-two-days recording
    -- during this window means a mismatch here carries no evidence either
    -- way. Resumes at full strength from 2026-11-01, including the
    -- "skipped day" tolerance (ORDER BY date DESC LIMIT 1 already looks past
    -- any day with no closing recorded at all, not just the immediately
    -- preceding one).
    IF r.date >= '2026-11-01' THEN
        SELECT closing_balance_bags INTO v_prev_closing
          FROM daily_feed_bag_stock
         WHERE farm_code = r.farm_code AND flock_group = r.flock_group
           AND date < r.date AND closing_balance_bags IS NOT NULL
           AND deleted_at IS NULL
         ORDER BY date DESC LIMIT 1;
        IF v_prev_closing IS NOT NULL AND r.opening_balance_bags IS NOT NULL
           AND r.opening_balance_bags <> v_prev_closing THEN
            reasons := reasons || format(
                'opening_balance_bags %s does not match the previous day''s closing balance %s for %s',
                r.opening_balance_bags, v_prev_closing, r.flock_group);
        END IF;
    END IF;

    RETURN reasons;
END;
$$;

COMMIT;
