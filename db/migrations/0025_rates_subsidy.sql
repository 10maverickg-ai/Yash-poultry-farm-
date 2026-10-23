-- Migration 0025 (V5 item 1.2): BAFTA rate message details.
-- Additive only. bafta_rate stays "rupees per egg" (as the Aug rows already
-- are); the new columns keep what was pasted and the subsidy.
BEGIN;
ALTER TABLE daily_egg_rates
    ADD COLUMN IF NOT EXISTS rate_per_100     numeric,
    ADD COLUMN IF NOT EXISTS subsidy_paise    integer NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS original_text    text,
    ADD COLUMN IF NOT EXISTS date_in_message  date,
    ADD COLUMN IF NOT EXISTS carried_forward  boolean NOT NULL DEFAULT false;
COMMIT;
