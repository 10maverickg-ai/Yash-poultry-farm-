-- Migration 0043 (V11): daily weather for the farm (Dandrala / Mohali, Punjab), filled by a server job from the free
-- Open-Meteo archive and forecast API. Additive only. A forecast row (a date today or later) is overwritten by the archive value later.
BEGIN;
CREATE TABLE IF NOT EXISTS weather_daily (
    farm_code      text NOT NULL DEFAULT 'YPF',
    date           date NOT NULL,
    temp_max_c     numeric(4,1),
    temp_min_c     numeric(4,1),
    humidity_mean  numeric(4,1),  -- percent, daily mean of relative humidity at 2 m
    rain_mm        numeric(5,1),
    source         text NOT NULL, -- 'open-meteo archive' or 'open-meteo forecast'
    fetched_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (farm_code, date)
);
COMMENT ON TABLE weather_daily IS 'Open-Meteo daily weather for lat 30.70 lon 76.72 (Mohali / Dandrala). Cache only; the app works without it.';
COMMENT ON COLUMN realistic_target_overrides.ratio_pct IS 'HD and feed: percent of the breeder''s book. Deaths (from V11): percent of birds per week that is "our usual". Applies to every season of the band.';
COMMIT;
