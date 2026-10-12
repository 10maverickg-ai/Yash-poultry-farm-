-- =============================================================================
-- Migration 0019: written-HD clean tolerance tightened to one shared
-- constant (owner request, 2026-10-12)
--
-- Three real production rows saved as fully clean with a written-vs-
-- calculated HD% gap of 0.44-0.49 points, while almost every other row on
-- this farm's register sits within about 0.1:
--   - BAB-10, 2026-08-07: written 65.10, calculated 65.54
--   - BAB-1,  2026-08-06: written 69.40, calculated 68.96
--   - BAB-8,  2026-08-05: written 70.50, calculated 70.01
--
-- Root cause: this function's own Rule 1 had TWO independent thresholds
-- (0.2 for a quiet note, 1.0 for a real flag) that were both looser than
-- lib/extraction/writtenHdCheck.ts's own engagement threshold (3.0) — so a
-- gap in the 0.3-3.0pt range reached NEITHER check: too small for this
-- function's old 1.0pt flag bar, and never even handed to the TS digit-
-- accuracy pass at all.
--
-- Fix: this function's Rule 1 no longer applies its own looser flag
-- threshold. lib/extraction/writtenHdCheck.ts's WRITTEN_HD_CLEAN_TOLERANCE
-- (0.3) is now the ONE boundary that matters for hd_percent_written vs
-- hd_percent — above it, the TS pipeline's applyWrittenHdCheck (stage 7)
-- has ALREADY run by the time this function sees the row: either it
-- auto-corrected hd_percent_written (so the gap recomputed here is small
-- again) or it added its own flag reason directly to the row's
-- extraReasons. This function would otherwise duplicate (or contradict —
-- a "within normal rounding, not flagged" quiet note on a row the TS
-- pipeline had ALREADY flagged) that decision. The 0.2-0.3pt quiet-note
-- band is kept, just narrower, for the genuinely tiny gaps still worth a
-- passing mention.
--
-- Same OUT-parameter shape as 0015/0017, so CREATE OR REPLACE is valid.
-- =============================================================================

BEGIN;

CREATE OR REPLACE FUNCTION fn_validate_daily_production(
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

    -- Rule 4: missing fields. hd_percent_written is deliberately EXCLUDED
    -- from this list (was included through migration 0014) — it's the
    -- supervisor's own written cross-check figure, not something the app
    -- needs: hd_percent (the generated, official figure) only depends on
    -- eggs_total/bird_population, both already checked below.
    IF r.mortality IS NULL THEN reasons := reasons || 'missing field: mortality'::text; END IF;
    IF r.feed_bags IS NULL THEN reasons := reasons || 'missing field: feed_bags'::text; END IF;
    IF r.eggs_total IS NULL THEN reasons := reasons || 'missing field: eggs_total'::text; END IF;
    IF r.bird_population IS NULL THEN reasons := reasons || 'missing field: bird_population'::text; END IF;

    -- Rule 1 (owner request, 2026-10-12 — see this migration's header):
    -- a gap at or below 0.3 points (lib/extraction/writtenHdCheck.ts's
    -- WRITTEN_HD_CLEAN_TOLERANCE) is ordinary rounding; a smaller-still gap
    -- (0.2-0.3) gets a quiet, non-flagging note. Anything above 0.3 is left
    -- ENTIRELY to the TS pipeline's own written-HD digit-accuracy pass,
    -- which by this point has already either corrected hd_percent_written
    -- or added its own flag reason — this function no longer applies a
    -- second, looser threshold of its own on top of that decision.
    IF r.hd_percent_written IS NOT NULL AND r.hd_percent IS NOT NULL THEN
        v_hd_gap := abs(r.hd_percent - r.hd_percent_written);
        IF v_hd_gap >= 0.2 AND v_hd_gap <= 0.3 THEN
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
