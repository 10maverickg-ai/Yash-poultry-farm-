-- =============================================================================
-- Smoke test: exercises the schema and every validation function with
-- realistic register data, asserting expected pass/flag outcomes.
-- Runs inside a transaction and rolls back — leaves no data behind.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/smoke_test.sql
-- =============================================================================

BEGIN;

DO $$
DECLARE
    v_flock_a  uuid;
    v_flock_b  uuid;
    v_prod_id  bigint;
    v_sum_id   bigint;
    v_reasons  text[];
    v_resolved uuid;
    v_balance  integer;
BEGIN
    ------------------------------------------------------------------
    -- Setup: shed, two flocks, label history with a renumbering event.
    -- Flock A held 'BAB-I' until 2026-01-31 (depleted); flock B took
    -- over the 'BAB-I' label from 2026-02-01.
    ------------------------------------------------------------------
    INSERT INTO sheds (farm_code, shed_code, shed_type, max_capacity)
    VALUES ('YPF', 'Shed 4', 'layer', 15000);

    INSERT INTO flocks (farm_code, display_label, breed, placement_date,
                        initial_chick_count, current_bird_count, current_shed,
                        current_stage, status, depletion_date)
    VALUES ('YPF', 'BAB-I', 'BV300', '2024-06-01', 13000, 0, 'Shed 4',
            'layer', 'depleted', '2026-01-31')
    RETURNING flock_internal_id INTO v_flock_a;

    INSERT INTO flocks (farm_code, display_label, breed, placement_date,
                        initial_chick_count, current_bird_count, current_shed,
                        current_stage, status)
    VALUES ('YPF', 'BAB-I', 'BV300', '2025-05-10', 13000, 12500, 'Shed 4',
            'layer', 'active')
    RETURNING flock_internal_id INTO v_flock_b;

    INSERT INTO flock_label_history (flock_internal_id, display_label, effective_from, effective_to)
    VALUES (v_flock_a, 'BAB-I', '2024-06-01', '2026-01-31'),
           (v_flock_b, 'BAB-II', '2025-05-10', '2026-01-31'),
           (v_flock_b, 'BAB-I', '2026-02-01', NULL);

    -- Label resolution: same label, different dates -> different flocks.
    v_resolved := resolve_flock_internal_id('YPF', 'BAB-I', '2025-12-01');
    ASSERT v_resolved = v_flock_a, 'BAB-I in Dec 2025 should resolve to flock A';
    v_resolved := resolve_flock_internal_id('YPF', 'BAB-I', '2026-03-01');
    ASSERT v_resolved = v_flock_b, 'BAB-I in Mar 2026 should resolve to flock B';
    v_resolved := resolve_flock_internal_id('YPF', 'BAB-IX', '2026-03-01');
    ASSERT v_resolved IS NULL, 'unknown label should resolve to NULL (caller flags)';

    ------------------------------------------------------------------
    -- daily_production: clean row passes; bad HD% and missing field flag.
    ------------------------------------------------------------------
    -- Seven days of history for the trailing-average mortality rule.
    FOR i IN 1..7 LOOP
        INSERT INTO daily_production (date, farm_code, flock_internal_id,
            display_label_as_written, shed_code, mortality, feed_bags,
            eggs_total, bird_population, hd_percent)
        VALUES (date '2026-06-20' + i, 'YPF', v_flock_b, 'BAB-I', 'Shed 4',
                4, 10, 11000, 12510 - i, round(11000.0 / (12510 - i) * 100, 2));
    END LOOP;

    -- Clean row: correct HD%, normal mortality, population decreasing.
    INSERT INTO daily_production (date, farm_code, flock_internal_id,
        display_label_as_written, shed_code, mortality, feed_bags,
        eggs_total, bird_population, hd_percent)
    VALUES ('2026-06-28', 'YPF', v_flock_b, 'BAB-I', 'Shed 4',
            5, 10, 11000, 12500, 88.00)
    RETURNING id INTO v_prod_id;
    v_reasons := fn_validate_daily_production(v_prod_id);
    ASSERT v_reasons = '{}', format('clean production row should not flag: %s', v_reasons);

    -- Bad row: HD%% off by >0.2, mortality 20 > 3x avg(4), population jumped up.
    INSERT INTO daily_production (date, farm_code, flock_internal_id,
        display_label_as_written, shed_code, mortality, feed_bags,
        eggs_total, bird_population, hd_percent)
    VALUES ('2026-06-29', 'YPF', v_flock_b, 'BAB-I', 'Shed 4',
            20, 10, 11000, 12600, 82.50)
    RETURNING id INTO v_prod_id;
    v_reasons := fn_validate_daily_production(v_prod_id);
    ASSERT array_length(v_reasons, 1) = 3,
        format('bad production row should raise 3 flags (HD%%, mortality, population): %s', v_reasons);

    -- Missing field: blank eggs_total in photo.
    INSERT INTO daily_production (date, farm_code, flock_internal_id, mortality,
                                  feed_bags, bird_population, hd_percent)
    VALUES ('2026-06-30', 'YPF', v_flock_b, 4, 10, 12480, 88.0)
    RETURNING id INTO v_prod_id;
    v_reasons := fn_validate_daily_production(v_prod_id);
    ASSERT 'missing field: eggs_total' = ANY (v_reasons),
        format('blank eggs_total should flag as missing: %s', v_reasons);

    ------------------------------------------------------------------
    -- Egg stock ledger: header + entries, running balances, checks.
    -- Ledger: total 57030, Sale Sukha -18000, Breakage -230, Anil -6000
    -- => closing 32800.
    ------------------------------------------------------------------
    INSERT INTO daily_egg_stock_summary (date, farm_code, total_eggs_produced,
        grade_13_eggs, grade_14_eggs, grade_15_eggs, grade_15plus_eggs,
        closing_balance_eggs)
    VALUES ('2026-06-29', 'YPF', 57030, 12000, 25000, 15000, 5030, 32800)
    RETURNING id INTO v_sum_id;

    INSERT INTO daily_egg_stock_entries (egg_stock_summary_id, sequence_order,
                                         label_as_written, category, amount_eggs)
    VALUES (v_sum_id, 1, 'Sukha(-)', 'sale', -18000),
           (v_sum_id, 2, 'Breakage(-)', 'breakage', -230),
           (v_sum_id, 3, 'Anil(-)', 'cross_farm_adjustment', -6000);

    PERFORM fn_recompute_egg_stock_running_balances(v_sum_id);
    SELECT running_balance_after INTO v_balance
      FROM daily_egg_stock_entries
     WHERE egg_stock_summary_id = v_sum_id ORDER BY sequence_order DESC LIMIT 1;
    ASSERT v_balance = 32800, format('last running balance should be 32800, got %s', v_balance);

    -- Cross-table rule 3 fires here by design: the summary total (57030)
    -- doesn't match the smoke test's production rows — assert exactly that
    -- one flag, proving the ledger's own arithmetic passed.
    v_reasons := fn_validate_egg_stock_summary(v_sum_id);
    ASSERT array_length(v_reasons, 1) = 1
           AND v_reasons[1] LIKE 'total_eggs_produced%does not match daily_production sum%',
        format('ledger math should pass, only cross-table check should flag: %s', v_reasons);

    -- Now corrupt the closing balance -> both ledger balance rules must flag.
    UPDATE daily_egg_stock_summary SET closing_balance_eggs = 33800 WHERE id = v_sum_id;
    v_reasons := fn_validate_egg_stock_summary(v_sum_id);
    ASSERT array_length(v_reasons, 1) = 3,
        format('corrupted closing balance should raise 3 flags: %s', v_reasons);

    -- Trays display value tracks the generated column through the update.
    ASSERT (SELECT closing_balance_trays FROM daily_egg_stock_summary WHERE id = v_sum_id)
           = round(33800::numeric / 30, 2), 'closing_balance_trays generated column';

    ------------------------------------------------------------------
    -- Sales generated from the sale ledger line (Phase 3 will automate this).
    ------------------------------------------------------------------
    INSERT INTO sales (date, farm_code, source_ledger_entry_id, transaction_type,
                       buyer_or_recipient, eggs_quantity)
    SELECT '2026-06-29', 'YPF', e.id, 'sale_wholesaler', 'Sukha', abs(e.amount_eggs)
      FROM daily_egg_stock_entries e
     WHERE e.egg_stock_summary_id = v_sum_id AND e.category = 'sale';
    ASSERT (SELECT trays_quantity FROM sales WHERE buyer_or_recipient = 'Sukha')
           = 600.00, 'trays_quantity generated column (18000 / 30)';

    UPDATE daily_egg_stock_entries e
       SET linked_sale_id = s.id
      FROM sales s
     WHERE s.source_ledger_entry_id = e.id;

    ------------------------------------------------------------------
    -- Feed stock: balanced row passes; quintal/kg-style misread flags.
    ------------------------------------------------------------------
    INSERT INTO feed_stock (date, farm_code, material_name, opening_balance_kg,
                            purchase_kg, consumed_kg, closing_balance_kg)
    VALUES ('2026-06-29', 'YPF', 'Maize', 5000, 1000, 1200, 4800);
    v_reasons := fn_validate_feed_stock(
        (SELECT id FROM feed_stock WHERE material_name = 'Maize'));
    ASSERT v_reasons = '{}', format('balanced feed row should not flag: %s', v_reasons);

    -- The quintal/kg case: closing misread by a factor of 100.
    INSERT INTO feed_stock (date, farm_code, material_name, opening_balance_kg,
                            purchase_kg, consumed_kg, closing_balance_kg)
    VALUES ('2026-06-29', 'YPF', 'Bajra', 5000, 1000, 1200, 48);
    v_reasons := fn_validate_feed_stock(
        (SELECT id FROM feed_stock WHERE material_name = 'Bajra'));
    ASSERT v_reasons[1] LIKE 'feed balance mismatch%',
        format('quintal/kg misread should flag: %s', v_reasons);

    -- Blank purchase column = no purchase that day, not a missing field.
    INSERT INTO feed_stock (date, farm_code, material_name, opening_balance_kg,
                            consumed_kg, closing_balance_kg)
    VALUES ('2026-06-29', 'YPF', 'Salt', 500, 20, 480);
    v_reasons := fn_validate_feed_stock(
        (SELECT id FROM feed_stock WHERE material_name = 'Salt'));
    ASSERT v_reasons = '{}', format('blank purchase should not flag: %s', v_reasons);

    ------------------------------------------------------------------
    -- Uniqueness: second production row for same flock+day must fail.
    ------------------------------------------------------------------
    BEGIN
        INSERT INTO daily_production (date, farm_code, flock_internal_id)
        VALUES ('2026-06-28', 'YPF', v_flock_b);
        RAISE EXCEPTION 'duplicate flock+date row was not rejected';
    EXCEPTION WHEN unique_violation THEN
        NULL;  -- expected
    END;

    ------------------------------------------------------------------
    -- feed_formulation: versioned recipe rows for a group.
    ------------------------------------------------------------------
    INSERT INTO feed_formulation (effective_date, farm_code, formulation_group,
                                  material_name, quantity_kg, batch_total_kg,
                                  reason_for_change)
    VALUES ('2026-06-01', 'YPF', 'Flocks 1-6', 'Maize', 550, 1000, NULL),
           ('2026-06-01', 'YPF', 'Flocks 1-6', 'Soya', 200, 1000, NULL),
           ('2026-06-15', 'YPF', 'Flocks 1-6', 'Marble Powder', 90, 1000,
            'shell quality issue — increased calcium');

    RAISE NOTICE 'smoke test: all assertions passed';
END;
$$;

-- ---------------------------------------------------------------------------
-- BV300 depletion-curve rule (migration 0007): interpolation, first crossing
-- at standard + 2 points, no daily re-flag, re-flag on the next whole point.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_flock   uuid;
    v_id      bigint;
    v_reasons text[];
BEGIN
    -- Interpolation between the stated anchors (19:0, 60:3.1, 80:6.0, 100:9.0)
    ASSERT fn_bv300_depletion_standard(60) = 3.1;
    ASSERT abs(fn_bv300_depletion_standard(70) - 4.55) < 0.0001;
    ASSERT fn_bv300_depletion_standard(10) IS NULL, 'no benchmark before lay';
    ASSERT fn_bv300_depletion_standard(110) = 9.0, 'clamped beyond last anchor';

    INSERT INTO flocks (farm_code, display_label, placement_date,
                        initial_chick_count, current_bird_count, status)
    VALUES ('YPF', 'BV-TEST', '2025-01-01', 10200, 9279, 'active')
    RETURNING flock_internal_id INTO v_flock;

    -- Lay start (19 wks = 2025-05-14): base population 10000, all clean.
    INSERT INTO daily_production (date, farm_code, flock_internal_id, mortality,
                                  feed_bags, eggs_total, bird_population, hd_percent)
    VALUES ('2025-05-14', 'YPF', v_flock, 0, 8, 2500, 10000, 25.0)
    RETURNING id INTO v_id;
    v_reasons := fn_validate_daily_production(v_id);
    ASSERT v_reasons = '{}', format('lay-start row should not flag: %s', v_reasons);

    -- ~52 wks: cumulative mortality 6.00%% vs standard ~2.49%% -> first
    -- crossing of the +2 line, must flag.
    INSERT INTO daily_production (date, farm_code, flock_internal_id, mortality,
                                  feed_bags, eggs_total, bird_population, hd_percent)
    VALUES ('2025-12-30', 'YPF', v_flock, 600, 9, 8742, 9400, 93.0)
    RETURNING id INTO v_id;
    v_reasons := fn_validate_daily_production(v_id);
    ASSERT array_length(v_reasons, 1) = 1
           AND v_reasons[1] LIKE 'cumulative mortality above BV300 standard%',
        format('crossing +2 should flag once: %s', v_reasons);

    -- Next day, still above the line but not a whole point worse -> NO re-flag.
    INSERT INTO daily_production (date, farm_code, flock_internal_id, mortality,
                                  feed_bags, eggs_total, bird_population, hd_percent)
    VALUES ('2025-12-31', 'YPF', v_flock, 1, 9, 8741, 9399, 93.0)
    RETURNING id INTO v_id;
    v_reasons := fn_validate_daily_production(v_id);
    ASSERT v_reasons = '{}',
        format('steady excess must not re-flag daily: %s', v_reasons);

    -- Jump to 7.21%% (excess crosses the next whole point) -> re-flag.
    INSERT INTO daily_production (date, farm_code, flock_internal_id, mortality,
                                  feed_bags, eggs_total, bird_population, hd_percent)
    VALUES ('2026-01-01', 'YPF', v_flock, 120, 9, 8629, 9279, 93.0)
    RETURNING id INTO v_id;
    v_reasons := fn_validate_daily_production(v_id);
    ASSERT array_length(v_reasons, 1) = 1
           AND v_reasons[1] LIKE 'cumulative mortality above BV300 standard%',
        format('whole-point worsening should re-flag: %s', v_reasons);

    RAISE NOTICE 'BV300 depletion rule: all assertions passed';
END;
$$;

-- ---------------------------------------------------------------------------
-- daily_feed_bag_stock (migration 0008): internal-consistency and
-- cross-table (vs linked flocks' daily_production.feed_bags) flag rules.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
    v_flock_a uuid;
    v_flock_b uuid;
    v_id      bigint;
    v_reasons text[];
BEGIN
    INSERT INTO flocks (farm_code, display_label, placement_date, current_bird_count, status)
    VALUES ('YPF', 'FBS-A', '2024-01-01', 5000, 'active') RETURNING flock_internal_id INTO v_flock_a;
    INSERT INTO flocks (farm_code, display_label, placement_date, current_bird_count, status)
    VALUES ('YPF', 'FBS-B', '2024-01-01', 5000, 'active') RETURNING flock_internal_id INTO v_flock_b;

    INSERT INTO daily_production (date, farm_code, flock_internal_id, feed_bags)
    VALUES ('2026-07-09', 'YPF', v_flock_a, 10), ('2026-07-09', 'YPF', v_flock_b, 12);

    -- Arithmetic clean, no flocks linked yet -> cross-check skipped, not flagged.
    INSERT INTO daily_feed_bag_stock (date, farm_code, flock_group, opening_balance_bags,
        produced_bags, total_bags, consumed_bags, mill_inventory_bags, shed_inventory_bags,
        closing_balance_bags)
    VALUES ('2026-07-09', 'YPF', 'Layer (FBS-A/B)', 50, 50, 100, 70, 10, 20, 30)
    RETURNING id INTO v_id;
    v_reasons := fn_validate_feed_bag_stock(v_id);
    ASSERT v_reasons = '{}', format('unlinked row, clean arithmetic: %s', v_reasons);

    -- Link both flocks (sum feed_bags = 22) against consumed_bags = 70 -> flags.
    INSERT INTO daily_feed_bag_stock_flocks (feed_bag_stock_id, flock_internal_id)
    VALUES (v_id, v_flock_a), (v_id, v_flock_b);
    v_reasons := fn_validate_feed_bag_stock(v_id);
    ASSERT array_length(v_reasons, 1) = 1 AND v_reasons[1] LIKE 'consumed_bags%does not match%',
        format('cross-table mismatch should flag: %s', v_reasons);

    -- Reconcile consumed_bags to the linked total; break F+S=closing instead.
    UPDATE daily_feed_bag_stock SET consumed_bags = 22, closing_balance_bags = 78 WHERE id = v_id;
    v_reasons := fn_validate_feed_bag_stock(v_id);
    ASSERT array_length(v_reasons, 1) = 1 AND v_reasons[1] LIKE 'closing balance mismatch%',
        format('mill+shed no longer matches closing: %s', v_reasons);

    -- Fully reconcile -> no flags.
    UPDATE daily_feed_bag_stock SET mill_inventory_bags = 58, shed_inventory_bags = 20 WHERE id = v_id;
    v_reasons := fn_validate_feed_bag_stock(v_id);
    ASSERT v_reasons = '{}', format('fully reconciled row should not flag: %s', v_reasons);

    -- Missing field.
    INSERT INTO daily_feed_bag_stock (date, farm_code, flock_group, opening_balance_bags,
        consumed_bags, mill_inventory_bags, shed_inventory_bags, closing_balance_bags)
    VALUES ('2026-07-09', 'YPF', 'Grower (FBS-C)', 20, 15, 5, 0, 5)
    RETURNING id INTO v_id;
    v_reasons := fn_validate_feed_bag_stock(v_id);
    ASSERT 'missing field: produced_bags' = ANY(v_reasons),
        format('blank produced_bags should flag missing: %s', v_reasons);

    -- One row per group per day.
    BEGIN
        INSERT INTO daily_feed_bag_stock (date, farm_code, flock_group)
        VALUES ('2026-07-09', 'YPF', 'Grower (FBS-C)');
        RAISE EXCEPTION 'duplicate group+date row was not rejected';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    RAISE NOTICE 'feed_bag_stock: all assertions passed';
END;
$$;

-- farms + reference seed sanity.
DO $$
BEGIN
    ASSERT (SELECT total_capacity FROM farms WHERE farm_code = 'YPF') = 130000;
    ASSERT (SELECT total_capacity FROM farms WHERE farm_code = 'APF') = 70000;
    ASSERT (SELECT count(*) FROM feed_materials) = 28;
    ASSERT (SELECT count(*) FROM bv300_standard_rearing WHERE guide_version = '2023') = 18;
    ASSERT (SELECT count(*) FROM bv300_standard_laying WHERE guide_version = '2023') = 19;
    ASSERT (SELECT count(*) FROM bv300_cycle_goals WHERE guide_version = '2023') = 19;
    ASSERT (SELECT count(*) FROM bv300_water_quality WHERE guide_version = '2023') = 5;
END;
$$;

ROLLBACK;
