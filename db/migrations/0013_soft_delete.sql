-- =============================================================================
-- Migration 0013: soft delete for Daily Production + unresolved extractions
-- (owner request, 2026-09-28)
--
-- Delete on /flagged is for wrong or duplicate data (e.g. old test uploads) —
-- "Mark reviewed" stays the way to acknowledge a flag that reflects a real
-- event. Soft delete only: a deleted_at column, never a hard DELETE, so
-- nothing is ever unrecoverable from a database mistake, consistent with
-- this schema's whole approach to flagged-not-rejected data.
--
-- The (flock_internal_id, date) unique constraint has to change shape: with
-- a hard-delete-free world, deleting a wrong row and then re-uploading a
-- correct one for the same flock+date must not collide with the deleted
-- row. Swapped the table-level UNIQUE for a partial unique index that only
-- applies to non-deleted rows, and the INSERT ON CONFLICT target in
-- lib/extraction/writeDailyProduction.ts and app/production/actions.ts
-- moves to match it.
-- =============================================================================

BEGIN;

ALTER TABLE daily_production ADD COLUMN deleted_at timestamptz;
ALTER TABLE unresolved_extractions ADD COLUMN deleted_at timestamptz;

ALTER TABLE daily_production
    DROP CONSTRAINT IF EXISTS daily_production_flock_internal_id_date_key;

CREATE UNIQUE INDEX daily_production_flock_date_active_key
    ON daily_production (flock_internal_id, date)
    WHERE deleted_at IS NULL;

CREATE INDEX idx_daily_production_not_deleted
    ON daily_production (farm_code, date)
    WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- fn_validate_daily_production and fn_bv300_cum_mortality both read OTHER
-- daily_production rows for the same flock (trailing mortality average,
-- previous bird_population, cumulative laying mortality) — a soft-deleted
-- row (bad OCR read, duplicate upload) must not skew those comparisons for
-- the rows that are still live. Re-declared here with deleted_at IS NULL
-- added to every daily_production reference; the HD% rule (Rule 1) is
-- untouched in this migration — see the follow-up HD% split migration for
-- that rewrite.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_bv300_cum_mortality(
    p_flock uuid,
    p_date  date,
    OUT actual_pct numeric,
    OUT std_pct    numeric,
    OUT age_weeks  numeric
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_placement date;
    v_lay_start date;
    v_base      numeric;
    v_cum       numeric;
BEGIN
    SELECT placement_date INTO v_placement
      FROM flocks WHERE flock_internal_id = p_flock;
    IF v_placement IS NULL THEN RETURN; END IF;

    age_weeks := round((p_date - v_placement) / 7.0, 1);
    IF age_weeks < 19 THEN
        age_weeks := NULL;
        RETURN;
    END IF;
    v_lay_start := v_placement + 133;  -- 19 weeks

    SELECT dp.bird_population + coalesce(dp.mortality, 0) INTO v_base
      FROM daily_production dp
     WHERE dp.flock_internal_id = p_flock
       AND dp.date >= v_lay_start
       AND dp.bird_population IS NOT NULL
       AND dp.deleted_at IS NULL
     ORDER BY dp.date LIMIT 1;
    IF v_base IS NULL OR v_base <= 0 THEN RETURN; END IF;

    SELECT coalesce(sum(dp.mortality), 0) INTO v_cum
      FROM daily_production dp
     WHERE dp.flock_internal_id = p_flock
       AND dp.date >= v_lay_start AND dp.date <= p_date
       AND dp.deleted_at IS NULL;

    std_pct := round(fn_bv300_depletion_standard(age_weeks), 2);
    IF std_pct IS NULL THEN RETURN; END IF;
    actual_pct := round(v_cum / v_base * 100, 2);
END;
$$;

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
           AND dp.mortality IS NOT NULL
           AND dp.deleted_at IS NULL;
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
           AND dp.deleted_at IS NULL
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
               AND dp.deleted_at IS NULL
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
