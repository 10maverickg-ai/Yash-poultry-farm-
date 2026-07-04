-- =============================================================================
-- Migration 0007: BV300 breed-standard reference tables + cumulative-mortality
-- flag rule (owner-approved addition, 2026-07-04)
--
-- Source: bv300-standards-reference.md, compiled by the owner from Venky's
-- "BV300 Nutrition and Management Guide 2023". Static reference data —
-- guide_version keys every table so a future guide is NEW rows, never an
-- overwrite. Values are seeded in db/seeds/0003_bv300_standards.sql.
--
-- Owner's decision (option b):
--   - HD% and feed/bird/day vs standard -> Phase 4 dashboard only (their
--     gaps are persistent and daily values noisy; a daily flag would spam)
--   - cumulative laying mortality vs the standard depletion curve -> flag
--     NOW: flag once when a flock crosses standard + 2 points, re-flag only
--     per further whole point of worsening
-- =============================================================================

BEGIN;

-- Table A: rearing period (0-18 wks) — body weight & feed intake by week.
CREATE TABLE bv300_standard_rearing (
    guide_version        text NOT NULL,          -- e.g. '2023'
    week                 integer NOT NULL,
    target_body_weight_g integer,
    body_weight_min_g    integer,
    body_weight_max_g    integer,
    feed_per_day_g       integer,
    stage                text,
    PRIMARY KEY (guide_version, week)
);

-- Table B: laying period (19-100 wks) — the primary comparison table.
-- Source doc is condensed to ~5-week steps; comparisons interpolate linearly
-- between rows at query time. cumulative_depletion_percent is filled ONLY at
-- the ages the source states (19/60/80/100) — interpolated values are always
-- computed, never stored as if they were the standard. The full week-by-week
-- table can be added later as extra rows with no logic change.
CREATE TABLE bv300_standard_laying (
    guide_version                text NOT NULL,
    age_weeks                    integer NOT NULL,
    std_hdp_percent              numeric(5, 2),
    feed_per_day_g               numeric(6, 1),
    feed_per_egg_g               numeric(6, 1),
    egg_weight_g                 numeric(5, 1),
    body_weight_g                integer,
    cumulative_depletion_percent numeric(5, 2),  -- null = not stated at this age
    PRIMARY KEY (guide_version, age_weeks)
);

-- Table C: whole-cycle headline goals — Phase 4 dashboard targets. Values
-- kept as text since the source mixes formats (ranges, kg, counts, %).
CREATE TABLE bv300_cycle_goals (
    guide_version  text NOT NULL,
    metric         text NOT NULL,
    standard_value text NOT NULL,
    PRIMARY KEY (guide_version, metric)
);

-- Table E: drinking water quality — reference checklist only, no UI/flags.
CREATE TABLE bv300_water_quality (
    guide_version text NOT NULL,
    parameter     text NOT NULL,
    recommended   text NOT NULL,
    PRIMARY KEY (guide_version, parameter)
);

-- ---------------------------------------------------------------------------
-- Standard cumulative depletion at an arbitrary age, by linear interpolation
-- between the stated anchor ages. NULL below the curve's start (rearing is
-- not covered by this benchmark); clamped to the last anchor beyond 100 wks.
-- ---------------------------------------------------------------------------
CREATE FUNCTION fn_bv300_depletion_standard(
    p_age_weeks numeric,
    p_guide     text DEFAULT '2023'
) RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_lo_age numeric;
    v_lo_val numeric;
    v_hi_age numeric;
    v_hi_val numeric;
BEGIN
    SELECT age_weeks, cumulative_depletion_percent INTO v_lo_age, v_lo_val
      FROM bv300_standard_laying
     WHERE guide_version = p_guide AND cumulative_depletion_percent IS NOT NULL
       AND age_weeks <= p_age_weeks
     ORDER BY age_weeks DESC LIMIT 1;
    IF v_lo_age IS NULL THEN
        RETURN NULL;  -- younger than the curve's first anchor
    END IF;

    SELECT age_weeks, cumulative_depletion_percent INTO v_hi_age, v_hi_val
      FROM bv300_standard_laying
     WHERE guide_version = p_guide AND cumulative_depletion_percent IS NOT NULL
       AND age_weeks > p_age_weeks
     ORDER BY age_weeks LIMIT 1;
    IF v_hi_age IS NULL THEN
        RETURN v_lo_val;  -- beyond the last anchor: clamp
    END IF;

    RETURN v_lo_val + (v_hi_val - v_lo_val) * (p_age_weeks - v_lo_age) / (v_hi_age - v_lo_age);
END;
$$;

-- ---------------------------------------------------------------------------
-- A flock's cumulative laying-period mortality vs the standard, as of a date.
--   base   = start-of-day population of the flock's first Daily Production
--            row at/after lay start (placement + 19 weeks) — the hen-housed
--            approximation available from register data
--   actual = SUM(mortality) over the laying window / base
-- All OUT params are NULL when the comparison doesn't apply (no placement
-- date, flock younger than 19 wks, no laying rows yet, or no standard).
-- ---------------------------------------------------------------------------
CREATE FUNCTION fn_bv300_cum_mortality(
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
     ORDER BY dp.date LIMIT 1;
    IF v_base IS NULL OR v_base <= 0 THEN RETURN; END IF;

    SELECT coalesce(sum(dp.mortality), 0) INTO v_cum
      FROM daily_production dp
     WHERE dp.flock_internal_id = p_flock
       AND dp.date >= v_lay_start AND dp.date <= p_date;

    std_pct := round(fn_bv300_depletion_standard(age_weeks), 2);
    IF std_pct IS NULL THEN RETURN; END IF;
    actual_pct := round(v_cum / v_base * 100, 2);
END;
$$;

-- ---------------------------------------------------------------------------
-- fn_validate_daily_production, extended with rule 5. Rules 1-4 unchanged
-- from migration 0006.
--
-- Rule 5 semantics (owner-approved): compare cumulative laying mortality to
-- the standard depletion curve. Flag on the day the excess over standard
-- FIRST crosses +2 points, then again only when it crosses each further
-- whole point (+3, +4, …) — computed against the previous production day's
-- excess, so a flock sitting steadily above the line does not re-flag daily.
-- Complements rule 2: that catches acute spikes, this catches slow bleeds
-- the trailing average normalizes away.
-- ---------------------------------------------------------------------------
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
