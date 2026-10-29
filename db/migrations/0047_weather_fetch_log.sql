-- Migration 0047 (V12 N8): a small log of every weather fetch attempt (the daily job and the "Refresh weather now" button), so the
-- Settings page can say when the weather last came in and, if it failed, why. Additive only; no RLS change; the app works without it.
BEGIN;
CREATE TABLE IF NOT EXISTS weather_fetch_log (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    farm_code    text NOT NULL DEFAULT 'YPF',
    attempted_at timestamptz NOT NULL DEFAULT now(),
    trigger      text NOT NULL,        -- 'daily job' | 'button' | 'page'
    outcome      text NOT NULL,        -- 'ok' | 'partial' | 'failed'
    rows_written integer,
    message      text                  -- the raw reason when it did not fully work
);
CREATE INDEX IF NOT EXISTS idx_weather_fetch_log_when ON weather_fetch_log (farm_code, attempted_at DESC);
COMMENT ON TABLE weather_fetch_log IS 'One row per weather fetch attempt; read by /settings. Old rows can be deleted at any time.';
COMMIT;
