-- =============================================================================
-- Migration 0009: chick_batch_log (owner addition, 2026-07-10)
--
-- Lightweight holding place for chick/grower batches that don't have a BAB
-- number yet — separate from flocks, which requires a display_label. Once a
-- batch is assigned a BAB number it gets created properly in flocks as
-- normal (via the existing "New flock" flow); this table has no link to
-- flocks and nothing here converts automatically — that's a manual step the
-- owner does once numbering happens.
--
-- No validation rules beyond missing-field checks, per instruction — this
-- is deliberately not cross-checked against anything.
-- =============================================================================

BEGIN;

CREATE TABLE chick_batch_log (
    id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    farm_code         text NOT NULL REFERENCES farms (farm_code),
    date              date NOT NULL,
    shed_code         text NOT NULL,
    total_birds       integer CHECK (total_birds >= 0),
    source_hatchery   text,
    notes             text,
    flagged           boolean NOT NULL DEFAULT false,
    flag_reason       text,
    reviewed_by_owner boolean NOT NULL DEFAULT false
);

CREATE INDEX idx_chick_batch_log_farm_date ON chick_batch_log (farm_code, date);

-- Missing-field flag rule (general trigger, all registers) — same hybrid
-- pattern as every other fn_validate_*: never blocks a write, just flags.
CREATE FUNCTION fn_validate_chick_batch_log(p_id bigint)
RETURNS text[]
LANGUAGE plpgsql STABLE AS $$
DECLARE
    r       chick_batch_log%ROWTYPE;
    reasons text[] := '{}';
BEGIN
    SELECT * INTO r FROM chick_batch_log WHERE id = p_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'chick_batch_log id % not found', p_id;
    END IF;

    IF r.shed_code IS NULL OR r.shed_code = '' THEN
        reasons := reasons || 'missing field: shed_code'::text;
    END IF;
    IF r.total_birds IS NULL THEN
        reasons := reasons || 'missing field: total_birds'::text;
    END IF;

    RETURN reasons;
END;
$$;

COMMIT;
