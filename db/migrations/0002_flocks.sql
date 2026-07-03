-- =============================================================================
-- Migration 0002: flocks + flock_label_history + label resolution function
-- Source: yash-poultry-farm-schema-spec.md — Table 1 (flocks),
--         Table 1a (flock_label_history)
--
-- The paper display label (BAB-I, BAB-II, …) is a POSITION label that gets
-- reassigned when the oldest flock is depleted (all younger flocks shift down
-- one number). The internal ID is stable forever and never reused; the label
-- history table is what resolves "BAB-I on 2026-03-14" to the right flock.
-- =============================================================================

BEGIN;

CREATE TABLE flocks (
    flock_internal_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    farm_code              text NOT NULL REFERENCES farms (farm_code),
    display_label          text NOT NULL,       -- current label; history in flock_label_history
    breed                  text,                -- e.g. 'BV300'
    placement_date         date,                -- chick arrival date
    source_hatchery        text,                -- from hatchery bill photo (Venky's etc.)
    hatchery_bill_photo_url text,
    initial_chick_count    integer CHECK (initial_chick_count >= 0),
    -- Latest known population; also mirrored daily in daily_production.
    current_bird_count     integer CHECK (current_bird_count >= 0),
    current_shed           text,
    current_stage          flock_stage,
    -- e.g. {"chick_to_grower": "2025-08-01", "grower_to_layer": "2026-01-10"}
    -- (spec offered jsonb or a separate table; jsonb chosen — docs/DECISIONS.md)
    stage_transition_dates jsonb,
    status                 flock_status NOT NULL DEFAULT 'active',
    depletion_date         date,                -- when flock was fully sold off
    notes                  text,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (farm_code, current_shed) REFERENCES sheds (farm_code, shed_code),
    -- A depleted flock should carry its depletion date; an active one shouldn't.
    CHECK (status <> 'depleted' OR depletion_date IS NOT NULL),
    CHECK (status <> 'active' OR depletion_date IS NULL)
);

CREATE INDEX idx_flocks_farm ON flocks (farm_code);

-- Keep updated_at current on any row change.
CREATE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_flocks_updated_at
    BEFORE UPDATE ON flocks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------------
-- Table 1a: flock_label_history
-- Manual entry, low frequency (roughly annual renumbering events).
-- ---------------------------------------------------------------------------

CREATE TABLE flock_label_history (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    flock_internal_id uuid NOT NULL REFERENCES flocks (flock_internal_id),
    display_label     text NOT NULL,             -- e.g. 'BAB-I'
    effective_from    date NOT NULL,
    effective_to      date,                      -- null = current
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

CREATE INDEX idx_flock_label_history_flock ON flock_label_history (flock_internal_id);
CREATE INDEX idx_flock_label_history_label ON flock_label_history (display_label);

-- ---------------------------------------------------------------------------
-- Label resolution: display_label as written + date + farm -> flock_internal_id.
-- This is what prevents two different flocks' histories from silently merging
-- under one reused label like 'BAB-I'.
--
-- Returns NULL when no active label matches that date — per the extraction
-- spec the caller must flag the record for the owner (may indicate an
-- unlogged renumbering event). Raises if two flocks claim the same label on
-- the same date, since that means the history table itself is wrong.
-- ---------------------------------------------------------------------------

CREATE FUNCTION resolve_flock_internal_id(
    p_farm_code     text,
    p_display_label text,
    p_date          date
) RETURNS uuid
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_matches uuid[];
BEGIN
    SELECT array_agg(h.flock_internal_id)
      INTO v_matches
      FROM flock_label_history h
      JOIN flocks f ON f.flock_internal_id = h.flock_internal_id
     WHERE f.farm_code = p_farm_code
       AND h.display_label = p_display_label
       AND h.effective_from <= p_date
       AND (h.effective_to IS NULL OR h.effective_to >= p_date);

    IF v_matches IS NULL THEN
        RETURN NULL;  -- caller flags: no active label for this date
    ELSIF array_length(v_matches, 1) > 1 THEN
        RAISE EXCEPTION
            'label % on farm % resolves to % flocks on % — overlapping flock_label_history rows',
            p_display_label, p_farm_code, array_length(v_matches, 1), p_date;
    END IF;

    RETURN v_matches[1];
END;
$$;

COMMIT;
