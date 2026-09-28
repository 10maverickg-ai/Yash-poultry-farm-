-- =============================================================================
-- Migration 0014: hd_percent becomes the app-calculated figure (owner
-- request, 2026-09-28)
--
-- Splits what was one column into two:
--   hd_percent_written  — exactly what the supervisor/register/model wrote,
--                          preserved verbatim for reference and audit
--   hd_percent          — GENERATED ALWAYS from eggs_total/bird_population,
--                          the "official" figure every analytics query
--                          should read; it can never drift out of sync with
--                          the two numbers it's derived from, because it is
--                          not writable at all — any INSERT/UPDATE that
--                          tries to set it directly is rejected by Postgres
--
-- Same split applied to unresolved_extractions.hd_percent (renamed to
-- hd_percent_written) for naming consistency, though that table has no
-- generated column — it's pre-resolution staging data, not yet "official."
--
-- Rule 1 is rewritten to match: it no longer recomputes the calculated
-- figure (hd_percent IS that figure now), it compares hd_percent against
-- hd_percent_written. Two-tier response, owner-approved: a gap over 1.0
-- point is a real flag; a gap of 0.2 to 1.0 point is normal rounding on a
-- hand-filled register and becomes a quiet hd_percent_note instead, so it
-- never fills /flagged. This changes the function's result shape (adds
-- hd_percent_note as a second OUT column), which CREATE OR REPLACE cannot
-- do for an existing function — hence the DROP before CREATE.
-- =============================================================================

BEGIN;

ALTER TABLE daily_production RENAME COLUMN hd_percent TO hd_percent_written;

ALTER TABLE daily_production ADD COLUMN hd_percent numeric(5, 2)
    GENERATED ALWAYS AS (
        CASE
            WHEN bird_population IS NOT NULL AND bird_population > 0
                 AND eggs_total IS NOT NULL
            THEN round(eggs_total::numeric / bird_population * 100, 2)
            ELSE NULL
        END
    ) STORED;

ALTER TABLE daily_production ADD COLUMN hd_percent_note text;

COMMENT ON COLUMN daily_production.hd_percent IS
    'App-calculated: eggs_total / bird_population * 100, rounded to 2 decimals. Generated always — cannot be written to directly. This is the official figure for analytics and display.';
COMMENT ON COLUMN daily_production.hd_percent_written IS
    'Exactly what was written on the register (or typed on the manual entry screen) — kept for reference and audit, not used in calculations.';
COMMENT ON COLUMN daily_production.hd_percent_note IS
    'Set by fn_validate_daily_production when hd_percent and hd_percent_written differ by 0.2-1.0 percentage points — a normal-rounding gap, intentionally not a flag. NULL otherwise.';

ALTER TABLE unresolved_extractions RENAME COLUMN hd_percent TO hd_percent_written;

DROP FUNCTION fn_validate_daily_production(bigint);

CREATE FUNCTION fn_validate_daily_production(
    p_id bigint,
    OUT reasons text[],
    OUT hd_percent_note text
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    r               daily_production%ROWTYPE;
    v_hd_gap        numeric;
    v_trailing_avg  numeric;
    v_prev_bird_pop integer;
    v_cur           record;
    v_prev_date     date;
    v_prev          record;
    v_excess        numeric;
    v_prev_excess   numeric;
BEGIN
    reasons := '{}';
    SELECT * INTO r FROM daily_production WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'daily_production id % not found', p_id;
    END IF;

    -- Rule 4: missing fields. "hd_percent" here still means the register's
    -- own % column — i.e. whether anything was written — so this checks
    -- hd_percent_written, not the generated column (which is only ever
    -- missing when eggs_total/bird_population already are, and rule 4
    -- reports those on their own).
    IF r.mortality IS NULL THEN reasons := reasons || 'missing field: mortality'::text; END IF;
    IF r.feed_bags IS NULL THEN reasons := reasons || 'missing field: feed_bags'::text; END IF;
    IF r.eggs_total IS NULL THEN reasons := reasons || 'missing field: eggs_total'::text; END IF;
    IF r.bird_population IS NULL THEN reasons := reasons || 'missing field: bird_population'::text; END IF;
    IF r.hd_percent_written IS NULL THEN reasons := reasons || 'missing field: hd_percent'::text; END IF;

    -- Rule 1 (rewritten): hd_percent is now GENERATED ALWAYS and IS the
    -- calculated figure, so there is nothing left to recompute here — just
    -- compare it against what was actually written. A small gap (0.2-1.0
    -- points) is ordinary rounding on a hand-filled register and becomes a
    -- quiet note instead of a flag; only a gap over 1.0 point is a real
    -- discrepancy worth the owner's attention.
    IF r.hd_percent_written IS NOT NULL AND r.hd_percent IS NOT NULL THEN
        v_hd_gap := abs(r.hd_percent - r.hd_percent_written);
        IF v_hd_gap > 1.0 THEN
            reasons := reasons || format(
                'HD%% mismatch: written %s%%, calculated %s%% (%s eggs / %s birds x 100)',
                r.hd_percent_written, r.hd_percent, r.eggs_total, r.bird_population);
        ELSIF v_hd_gap >= 0.2 THEN
            hd_percent_note := format(
                'Written %s%% vs calculated %s%% (gap %s pts) — within normal rounding, not flagged.',
                r.hd_percent_written, r.hd_percent, round(v_hd_gap, 2));
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
END;
$$;

COMMIT;
