-- =============================================================================
-- Migration 0015: digit-accuracy pass (owner request, 2026-09-28)
--
-- Three independent changes:
--
-- 1. daily_production.bird_population_original / auto_correction_note —
--    the day-to-day bal-bird chain check (bird_population[today] should
--    equal bird_population[previous day] - mortality[today]) can now
--    auto-correct a misread bal_bird when the corrected value is
--    corroborated by the written HD% (see app/upload/actions.ts). An
--    auto-corrected row is saved CLEAN (not flagged) but must never lose
--    the original extracted value — bird_population_original preserves it,
--    auto_correction_note records what changed and why, shown as a quiet
--    note on the entry screen the same way hd_percent_note already is.
--    Both NULL on every row that was never auto-corrected.
--
-- 2. daily_production_page_issues — a page-level checksum mismatch (the
--    section subtotal the register itself writes doesn't match what the
--    individual flock rows sum to) is a property of the PAGE, not any one
--    flock. Previously (increment 8) this was attached to every flock row's
--    own flag_reason, which flagged an entire correct page over one
--    unreadable subtotal — exactly the false-positive behavior this
--    increment exists to fix. This table gives page-level issues their own
--    flagged/reviewed/deleted lifecycle, mirroring every other register's
--    pattern in this schema, so /flagged can show it ONCE as a banner
--    instead of on every row.
--
-- 3. fn_validate_daily_production Rule 4 — "missing field: hd_percent"
--    (i.e. hd_percent_written is null) stops being a flag. hd_percent is
--    now the GENERATED, app-calculated figure (migration 0014) and is what
--    every analytics query reads; the supervisor not writing a % on the
--    register is no longer missing data the app needs, just a written
--    cross-check that happens to be absent. Same OUT-parameter shape as
--    before, so CREATE OR REPLACE is valid (no DROP needed, unlike 0014's
--    rewrite which changed the shape).
-- =============================================================================

BEGIN;

ALTER TABLE daily_production ADD COLUMN bird_population_original integer;
ALTER TABLE daily_production ADD COLUMN auto_correction_note text;

COMMENT ON COLUMN daily_production.bird_population_original IS
    'The raw extracted bal_bird value BEFORE an automatic day-to-day chain correction (see auto_correction_note). NULL unless this row was auto-corrected — bird_population itself always holds the corrected, saved value.';
COMMENT ON COLUMN daily_production.auto_correction_note IS
    'Set when bird_population was automatically corrected via the previous-day chain check (bird_population_original -> bird_population), with the reasoning. NULL otherwise. Informational only — an auto-corrected row is saved clean, not flagged.';

CREATE TABLE daily_production_page_issues (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    farm_code         text NOT NULL REFERENCES farms(farm_code),
    date              date NOT NULL,
    source_photo_url  text,
    issue_text        text NOT NULL,
    reviewed_by_owner boolean NOT NULL DEFAULT false,
    deleted_at        timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE daily_production_page_issues IS
    'Page-level extraction issues (e.g. a section subtotal checksum mismatch) that belong to an upload as a whole, not to any single flock row. Mirrors daily_production''s own flagged/reviewed/deleted lifecycle so these can be reviewed or dismissed independently, and shown once as a banner rather than duplicated onto every flock from that page.';

CREATE INDEX idx_daily_production_page_issues_open
    ON daily_production_page_issues (farm_code, date)
    WHERE deleted_at IS NULL AND NOT reviewed_by_owner;

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

    -- Rule 1 (unchanged from 0014): hd_percent is GENERATED ALWAYS and IS
    -- the calculated figure — just compare it against what was actually
    -- written. A small gap (0.2-1.0 points) is ordinary rounding on a
    -- hand-filled register and becomes a quiet note instead of a flag;
    -- only a gap over 1.0 point is a real discrepancy worth attention.
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
