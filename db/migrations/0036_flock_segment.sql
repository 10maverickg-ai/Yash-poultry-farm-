-- Migration 0036 (V8 S0.1): which group a flock belongs to, so analytics are
-- computed per segment instead of one whole-farm pool. Additive only.
--   main  = right page of the register: big eggs, mature flocks (BAB-1..BAB-8 and the departed ones)
--   young = left page: small eggs, young flocks still climbing to peak (BAB-9..BAB-11)
-- NULL = "segment not set": never guessed.
BEGIN;
ALTER TABLE flocks ADD COLUMN IF NOT EXISTS segment text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'flocks_segment_check') THEN
    ALTER TABLE flocks ADD CONSTRAINT flocks_segment_check CHECK (segment IN ('main','young'));
  END IF;
END $$;
UPDATE flocks SET segment = 'main'
 WHERE segment IS NULL AND (display_label ~ '^BAB-[1-8]$' OR display_label LIKE 'Old BAB-%');
UPDATE flocks SET segment = 'young'
 WHERE segment IS NULL AND display_label IN ('BAB-9','BAB-10','BAB-11');
COMMIT;
