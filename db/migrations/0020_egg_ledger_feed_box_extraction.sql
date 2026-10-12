-- =============================================================================
-- Migration 0020: egg stock ledger + feed bag box — ready for extraction
-- (owner request, 2026-10-19)
--
-- Nothing has ever written to daily_egg_stock_summary, daily_egg_stock_entries,
-- or daily_feed_bag_stock in production (confirmed: 0 rows in all three before
-- this migration) — so every change below is additive/structural, no backfill.
--
-- Four changes:
--
-- 1. daily_egg_stock_summary gets a `section` column ('small' / 'big') and
--    the unique constraint becomes (farm_code, date, section) — there was
--    previously no way to hold the farm's TWO parallel ledgers (owner-
--    confirmed: a big ledger under the BAB-1..7 table, a small ledger under
--    the BAB-8..10 table) for the same day at all. Also adds
--    opening_balance_eggs and total_line_eggs — the register's own OB and
--    "total" figures, both previously untracked; the existing
--    total_eggs_produced column is kept as the day's egg PRODUCTION figure
--    (register's own "(+)" line), not the total. *_original columns for
--    every auto-correctable field, auto_correction_note, and deleted_at
--    (soft delete, same pattern as daily_production — re-uploading a date
--    replaces that date+section's row, never duplicates). grade_* columns
--    are untouched, per the owner's explicit instruction not to drop them
--    without asking.
--
-- 2. daily_egg_stock_entries gets amount_eggs_original + auto_correction_note
--    for the same reason. No own deleted_at: an entry's lifecycle is tied to
--    its parent summary row (re-upload soft-deletes the OLD summary and
--    inserts a fresh one with fresh entries; an entry is never independently
--    deleted while its summary lives, and is always read via a join to a
--    non-deleted summary) — a deliberate choice, not an oversight, to avoid
--    two independently-driftable "deleted" states for data that only ever
--    changes together.
--
-- 3. egg_stock_entry_category gets two new values the owner's spec names
--    that the existing enum (sale, breakage, gift, cross_farm_adjustment,
--    production_addition, other) didn't have: 'local_sale' (a local buyer,
--    distinct from a Farmfresh 'sale') and 'labour_take'.
--
-- 4. daily_feed_bag_stock gets deleted_at (soft delete, matching every other
--    register) and one *_original column per raw read field (opening,
--    produced, total, consumed, mill (F), shed (S), closing) +
--    auto_correction_note — more columns than daily_production's four, but
--    the same one-column-per-field convention throughout this schema, kept
--    consistent rather than inventing a second pattern for this one table.
--    Its existing UNIQUE(farm_code, flock_group, date) becomes a partial
--    unique index WHERE deleted_at IS NULL, same reasoning as daily_production.
--
-- 5. A new table, ledger_extraction_issues, mirrors daily_production_page_issues
--    exactly: a page-level ("this upload's ledger/feed read failed or timed
--    out, re-run it") issue that belongs to the whole upload, not any one
--    row, with the same flagged/reviewed/deleted lifecycle.
--
-- 6. A new table, daily_egg_stock_summary_flocks, mirrors the EXISTING
--    daily_feed_bag_stock_flocks (migration 0008) for exactly the reason
--    that table was created: "big"/"small" membership can't be derived from
--    flock numbering alone (BAB-number ranges shift under renumbering —
--    see flocks/renumber — and daily_production itself stores no section/
--    table-membership column, by design: the Daily Production path must
--    behave exactly as it does today, so this migration adds nothing to
--    that table at all). Captured explicitly per entry, same as the feed
--    group link table, instead of guessed from a label range.
--
-- fn_validate_egg_stock_summary and fn_validate_feed_bag_stock are rewritten
-- for the owner's full 5-point checklists (section/group-aware,
-- deleted_at-filtered, previous-day-same-section/group lookup). These
-- functions are the SINGLE source of flagged/flag_reason for BOTH the manual
-- entry screens (saveEggStock/saveFeedBagStock) and the new auto-extraction
-- path — the auto-extraction path's own TS-side digit-repair logic (see
-- lib/extraction/digitRepair.ts) only ever tries to FIX a value before
-- writing it; whether the (possibly-still-wrong) saved row ends up flagged,
-- and with what exact wording, is decided here, in one place, the same way
-- fn_validate_daily_production already serves both of ITS write paths.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. daily_egg_stock_summary
-- ---------------------------------------------------------------------------

ALTER TABLE daily_egg_stock_summary ADD COLUMN section text;
UPDATE daily_egg_stock_summary SET section = 'big' WHERE section IS NULL; -- no-op: 0 rows exist
ALTER TABLE daily_egg_stock_summary ALTER COLUMN section SET NOT NULL;
ALTER TABLE daily_egg_stock_summary ADD CONSTRAINT daily_egg_stock_summary_section_check
    CHECK (section IN ('small', 'big'));

ALTER TABLE daily_egg_stock_summary ADD COLUMN opening_balance_eggs integer CHECK (opening_balance_eggs >= 0);
ALTER TABLE daily_egg_stock_summary ADD COLUMN opening_balance_eggs_original integer;
ALTER TABLE daily_egg_stock_summary ADD COLUMN total_line_eggs integer CHECK (total_line_eggs >= 0);
ALTER TABLE daily_egg_stock_summary ADD COLUMN total_line_eggs_original integer;
ALTER TABLE daily_egg_stock_summary ADD COLUMN total_eggs_produced_original integer;
ALTER TABLE daily_egg_stock_summary ADD COLUMN closing_balance_eggs_original integer;
ALTER TABLE daily_egg_stock_summary ADD COLUMN auto_correction_note text;
ALTER TABLE daily_egg_stock_summary ADD COLUMN deleted_at timestamptz;

COMMENT ON COLUMN daily_egg_stock_summary.section IS
    '''small'' = the ledger under the BAB-8..10 table, ''big'' = the ledger under the BAB-1..7 table. The farm runs these as two parallel, independent running balances on the same page.';
COMMENT ON COLUMN daily_egg_stock_summary.opening_balance_eggs IS
    'The register''s own OB figure (= the previous day''s closing_balance_eggs for the SAME section).';
COMMENT ON COLUMN daily_egg_stock_summary.total_line_eggs IS
    'The register''s own written "total" line (should equal opening_balance_eggs + total_eggs_produced) — tracked as its own read value, not just derived, so a misread total line is independently checkable.';
COMMENT ON COLUMN daily_egg_stock_summary.total_eggs_produced IS
    'The register''s "(+)" production figure for this section/day — should equal the SUM of daily_production.eggs_total for this section''s flocks on this date. NOT the total line (see total_line_eggs).';

ALTER TABLE daily_egg_stock_summary DROP CONSTRAINT IF EXISTS daily_egg_stock_summary_farm_code_date_key;
CREATE UNIQUE INDEX daily_egg_stock_summary_active_key
    ON daily_egg_stock_summary (farm_code, date, section)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_egg_stock_summary_not_deleted
    ON daily_egg_stock_summary (farm_code, date)
    WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 2. daily_egg_stock_entries
-- ---------------------------------------------------------------------------

ALTER TABLE daily_egg_stock_entries ADD COLUMN amount_eggs_original integer;
ALTER TABLE daily_egg_stock_entries ADD COLUMN auto_correction_note text;

-- Which flocks this section's row covers on this date — drives check 4
-- (production vs flock eggs_total sum). See point 6 above.
CREATE TABLE daily_egg_stock_summary_flocks (
    egg_stock_summary_id bigint NOT NULL REFERENCES daily_egg_stock_summary (id) ON DELETE CASCADE,
    flock_internal_id     uuid NOT NULL REFERENCES flocks (flock_internal_id),
    PRIMARY KEY (egg_stock_summary_id, flock_internal_id)
);

-- ---------------------------------------------------------------------------
-- 3. egg_stock_entry_category
-- ---------------------------------------------------------------------------

ALTER TYPE egg_stock_entry_category ADD VALUE IF NOT EXISTS 'local_sale';
ALTER TYPE egg_stock_entry_category ADD VALUE IF NOT EXISTS 'labour_take';

-- ---------------------------------------------------------------------------
-- 4. daily_feed_bag_stock
-- ---------------------------------------------------------------------------

ALTER TABLE daily_feed_bag_stock ADD COLUMN opening_balance_bags_original integer;
ALTER TABLE daily_feed_bag_stock ADD COLUMN produced_bags_original integer;
ALTER TABLE daily_feed_bag_stock ADD COLUMN total_bags_original integer;
ALTER TABLE daily_feed_bag_stock ADD COLUMN consumed_bags_original integer;
ALTER TABLE daily_feed_bag_stock ADD COLUMN mill_inventory_bags_original integer;
ALTER TABLE daily_feed_bag_stock ADD COLUMN shed_inventory_bags_original integer;
ALTER TABLE daily_feed_bag_stock ADD COLUMN closing_balance_bags_original integer;
ALTER TABLE daily_feed_bag_stock ADD COLUMN auto_correction_note text;
ALTER TABLE daily_feed_bag_stock ADD COLUMN deleted_at timestamptz;

ALTER TABLE daily_feed_bag_stock DROP CONSTRAINT IF EXISTS daily_feed_bag_stock_farm_code_flock_group_date_key;
CREATE UNIQUE INDEX daily_feed_bag_stock_active_key
    ON daily_feed_bag_stock (farm_code, flock_group, date)
    WHERE deleted_at IS NULL;
CREATE INDEX idx_feed_bag_stock_not_deleted
    ON daily_feed_bag_stock (farm_code, date)
    WHERE deleted_at IS NULL;

-- ---------------------------------------------------------------------------
-- 5. ledger_extraction_issues — mirrors daily_production_page_issues
-- ---------------------------------------------------------------------------

CREATE TABLE ledger_extraction_issues (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    farm_code         text NOT NULL REFERENCES farms(farm_code),
    date              date NOT NULL,
    source_photo_url  text,
    issue_text        text NOT NULL,
    reviewed_by_owner boolean NOT NULL DEFAULT false,
    deleted_at        timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE ledger_extraction_issues IS
    'The egg-ledger/feed-box vision call (lib/extraction/ledgerFeedExtraction.ts) failed, timed out, or could not be matched to this date/farm — a separate, best-effort step that must never block or affect the Daily Production save it always runs after. One row per failed attempt; shown on /flagged as a "ledger not read, re-run" banner, same lifecycle as daily_production_page_issues.';

CREATE INDEX idx_ledger_extraction_issues_open
    ON ledger_extraction_issues (farm_code, date)
    WHERE deleted_at IS NULL AND NOT reviewed_by_owner;

-- ---------------------------------------------------------------------------
-- fn_validate_egg_stock_summary — rewritten for the real 5-point checklist
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_validate_egg_stock_summary(p_id bigint)
RETURNS text[]
LANGUAGE plpgsql STABLE AS $$
DECLARE
    s                daily_egg_stock_summary%ROWTYPE;
    reasons          text[] := '{}';
    v_entries_sum    integer;
    v_entries_count  integer;
    v_last_balance   integer;
    v_production_sum integer;
    v_linked_count   integer;
    v_prev_closing   integer;
BEGIN
    SELECT * INTO s FROM daily_egg_stock_summary WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'daily_egg_stock_summary id % not found', p_id;
    END IF;

    IF s.opening_balance_eggs IS NULL THEN reasons := reasons || 'missing field: opening_balance_eggs'::text; END IF;
    IF s.total_eggs_produced IS NULL THEN reasons := reasons || 'missing field: total_eggs_produced'::text; END IF;
    IF s.closing_balance_eggs IS NULL THEN reasons := reasons || 'missing field: closing_balance_eggs'::text; END IF;

    -- Check 1: every quantity (opening, production, total line, closing,
    -- every entry) is a multiple of 30 (eggs only ever move in whole trays).
    IF s.opening_balance_eggs IS NOT NULL AND s.opening_balance_eggs % 30 <> 0 THEN
        reasons := reasons || format('opening_balance_eggs %s is not a multiple of 30', s.opening_balance_eggs);
    END IF;
    IF s.total_eggs_produced IS NOT NULL AND s.total_eggs_produced % 30 <> 0 THEN
        reasons := reasons || format('total_eggs_produced %s is not a multiple of 30', s.total_eggs_produced);
    END IF;
    IF s.total_line_eggs IS NOT NULL AND s.total_line_eggs % 30 <> 0 THEN
        reasons := reasons || format('total_line_eggs %s is not a multiple of 30', s.total_line_eggs);
    END IF;
    IF s.closing_balance_eggs IS NOT NULL AND s.closing_balance_eggs % 30 <> 0 THEN
        reasons := reasons || format('closing_balance_eggs %s is not a multiple of 30', s.closing_balance_eggs);
    END IF;
    IF EXISTS (
        SELECT 1 FROM daily_egg_stock_entries e
         WHERE e.egg_stock_summary_id = s.id AND e.amount_eggs % 30 <> 0
    ) THEN
        reasons := reasons || 'a ledger line amount is not a multiple of 30'::text;
    END IF;

    -- Check 2: opening + production = total line (both read values).
    IF s.opening_balance_eggs IS NOT NULL AND s.total_eggs_produced IS NOT NULL
       AND s.total_line_eggs IS NOT NULL
       AND s.opening_balance_eggs + s.total_eggs_produced <> s.total_line_eggs THEN
        reasons := reasons || format(
            'opening %s + production %s = %s, but the register''s total line reads %s',
            s.opening_balance_eggs, s.total_eggs_produced,
            s.opening_balance_eggs + s.total_eggs_produced, s.total_line_eggs);
    END IF;

    -- Check 3: total line − sum(deductions) = closing. amount_eggs is
    -- SIGNED (deductions negative), so this is total_line + sum(amount_eggs).
    SELECT coalesce(sum(e.amount_eggs), 0), count(*)
      INTO v_entries_sum, v_entries_count
      FROM daily_egg_stock_entries e
     WHERE e.egg_stock_summary_id = s.id;

    IF s.total_line_eggs IS NOT NULL AND s.closing_balance_eggs IS NOT NULL
       AND s.total_line_eggs + v_entries_sum <> s.closing_balance_eggs THEN
        reasons := reasons || format(
            'ledger balance mismatch: total line %s + entries sum %s = %s, but closing reads %s',
            s.total_line_eggs, v_entries_sum, s.total_line_eggs + v_entries_sum, s.closing_balance_eggs);
    END IF;

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

    -- Check 4: cross-table — production should equal the SUM of eggs_total
    -- for the flocks LINKED to this section (daily_egg_stock_summary_flocks
    -- — never guessed from a label range, same reasoning as the feed group
    -- link table). Deliberately worded to point at NEITHER side as the
    -- culprit — the cause could be either (owner's explicit instruction).
    -- Skipped (not flagged) when no flocks are linked yet — an incomplete
    -- entry, not a proven mismatch, same rule fn_validate_feed_bag_stock
    -- already uses.
    SELECT sum(dp.eggs_total), count(*) INTO v_production_sum, v_linked_count
      FROM daily_egg_stock_summary_flocks link
      JOIN daily_production dp
        ON dp.flock_internal_id = link.flock_internal_id AND dp.date = s.date
       AND dp.deleted_at IS NULL
     WHERE link.egg_stock_summary_id = s.id;
    IF v_linked_count > 0 AND v_production_sum IS NOT NULL AND s.total_eggs_produced IS NOT NULL
       AND s.total_eggs_produced <> v_production_sum THEN
        reasons := reasons || format(
            'ledger and flock rows disagree by %s: ledger production %s vs linked flocks'' eggs_total sum %s for %s',
            abs(s.total_eggs_produced - v_production_sum), s.total_eggs_produced, v_production_sum, s.date);
    END IF;

    -- Check 5: opening equals the previous day's closing for the SAME
    -- section. Skipped (not flagged) when there's no previous day saved —
    -- an incomplete history, not a proven mismatch. Never looks at or
    -- implies changing the previous day's row.
    SELECT closing_balance_eggs INTO v_prev_closing
      FROM daily_egg_stock_summary
     WHERE farm_code = s.farm_code AND section = s.section
       AND date < s.date AND closing_balance_eggs IS NOT NULL
       AND deleted_at IS NULL
     ORDER BY date DESC LIMIT 1;
    IF v_prev_closing IS NOT NULL AND s.opening_balance_eggs IS NOT NULL
       AND s.opening_balance_eggs <> v_prev_closing THEN
        reasons := reasons || format(
            'opening_balance_eggs %s does not match the previous day''s closing balance %s for the %s ledger',
            s.opening_balance_eggs, v_prev_closing, s.section);
    END IF;

    RETURN reasons;
END;
$$;

-- ---------------------------------------------------------------------------
-- fn_validate_feed_bag_stock — extended with checks 1, 5 (2-4 already existed)
-- ---------------------------------------------------------------------------

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

    -- Check 1 (new): OB + produced = total line.
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

    -- Check 5 (new): OB equals the previous day's closing for the SAME
    -- flock_group. Skipped when there's no previous day saved. Never looks
    -- at or implies changing the previous day's row.
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

    RETURN reasons;
END;
$$;

-- ---------------------------------------------------------------------------
-- fn_recompute_egg_stock_running_balances — now starts from the register's
-- own total line (opening + production), not total_eggs_produced alone,
-- since opening_balance_eggs previously didn't exist at all. Falls back to
-- opening+production, then to production alone, so a manual entry that
-- never fills in total_line_eggs still gets a sensible running balance.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_recompute_egg_stock_running_balances(p_summary_id bigint)
RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
    v_balance integer;
    v_entry   record;
BEGIN
    SELECT coalesce(total_line_eggs, opening_balance_eggs + total_eggs_produced, total_eggs_produced)
      INTO v_balance
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

COMMIT;
