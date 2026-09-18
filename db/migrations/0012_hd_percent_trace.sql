-- =============================================================================
-- Migration 0012: HD% mismatch trace + shed_code no longer a flag trigger (2026-09-18)
--
-- Investigated the owner's report of a ~10x HD% discrepancy on BAB-9.
-- Traced every place HD% math happens in this codebase (grepped the whole
-- repo for hd_percent/eggs_total/bird_population): there is exactly ONE —
-- Rule 1 below, eggs_total / bird_population * 100 — and it is the
-- standard hen-day-percent formula, correctly wired, identical in this
-- migration and the 0007 version it replaces. hd_percent itself is never
-- computed or overwritten anywhere else in the app; it is stored exactly
-- as extracted or as typed on the manual entry screen. Also checked both
-- INSERT statements that populate daily_production
-- (lib/extraction/writeDailyProduction.ts, app/production/actions.ts) for
-- a column-order/swap bug — none found; eggs_total and bird_population map
-- to the correct positional parameters in both.
--
-- Conclusion: there is no divisor bug in this code. The most likely
-- explanation for a clean ~10x discrepancy is a genuine misread somewhere
-- in the three numbers involved (eggs_total, bird_population, or the
-- written hd_percent itself) — a decimal-point placement error is the
-- classic way a handwritten or photographed percentage ends up exactly
-- ~10x off. Rather than guess further without the actual BAB-9 numbers,
-- this migration makes the mismatch message self-diagnosing going
-- forward: it now states eggs_total and bird_population directly, so the
-- exact two numbers being divided are visible on /flagged without a
-- second lookup, for this row and every future one.
--
-- Also folds in the shed_code prompt change (lib/extraction/dailyProduction.ts,
-- same date): shed_code is no longer extracted, but nothing here needed to
-- change for that — it was never part of structural validation, only ever
-- flagged via the client-side low-confidence-on-any-field check in
-- app/upload/actions.ts, which stops seeing a shed_code confidence value at
-- all now that the field isn't requested.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_validate_daily_production(p_id bigint)
RETURNS text[]
LANGUAGE plpgsql STABLE AS $$
DECLARE
    r               daily_production%ROWTYPE;
    reasons         text[] := '{}';
    v_calc_hd       numeric;
    v_trailing_avg  numeric;
    v_prev_bird_pop integer;
    v_cur           record;
    v_prev_date     date;
    v_prev          record;
    v_excess        numeric;
    v_prev_excess   numeric;
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

    -- Rule 1: HD% cross-check, tolerance ±0.2 percentage points.
    -- Message now states the two raw numbers being divided (eggs_total,
    -- bird_population) directly, so a mismatch is self-diagnosing from
    -- /flagged alone — no second lookup needed to see what was divided.
    IF r.eggs_total IS NOT NULL AND r.bird_population IS NOT NULL
       AND r.bird_population > 0 AND r.hd_percent IS NOT NULL THEN
        v_calc_hd := round(r.eggs_total::numeric / r.bird_population * 100, 2);
        IF abs(v_calc_hd - r.hd_percent) > 0.2 THEN
            reasons := reasons || format(
                'HD%% mismatch: written %s%%, calculated %s%% (%s eggs / %s birds x 100)',
                r.hd_percent, v_calc_hd, r.eggs_total, r.bird_population);
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

    -- Rule 5: cumulative laying mortality vs BV300 depletion curve
    SELECT * INTO v_cur FROM fn_bv300_cum_mortality(r.flock_internal_id, r.date);
    IF v_cur.actual_pct IS NOT NULL AND v_cur.std_pct IS NOT NULL THEN
        v_excess := v_cur.actual_pct - v_cur.std_pct;
        IF v_excess > 2 THEN
            SELECT dp.date INTO v_prev_date
              FROM daily_production dp
             WHERE dp.flock_internal_id = r.flock_internal_id AND dp.date < r.date
             ORDER BY dp.date DESC LIMIT 1;
            IF v_prev_date IS NOT NULL THEN
                SELECT * INTO v_prev
                  FROM fn_bv300_cum_mortality(r.flock_internal_id, v_prev_date);
                IF v_prev.actual_pct IS NOT NULL AND v_prev.std_pct IS NOT NULL THEN
                    v_prev_excess := v_prev.actual_pct - v_prev.std_pct;
                END IF;
            END IF;
            IF v_prev_excess IS NULL OR v_prev_excess <= 2
               OR floor(v_excess - 2) > floor(v_prev_excess - 2) THEN
                reasons := reasons || format(
                    'cumulative mortality above BV300 standard: %s%% vs %s%% at %s weeks (+%s pts)',
                    v_cur.actual_pct, v_cur.std_pct, v_cur.age_weeks,
                    round(v_excess, 2));
            END IF;
        END IF;
    END IF;

    RETURN reasons;
END;
$$;

COMMIT;
