-- Migration 0046 (V12 N4): which way a day was entered. daily_production.source_tag exists since 0042; the egg ledger and the feed box
-- get the same column, so a day typed by hand in the app ('manual entry') is recognisable next to one read from a photo (NULL).
-- Additive only.
BEGIN;
ALTER TABLE daily_egg_stock_summary ADD COLUMN IF NOT EXISTS source_tag text;
ALTER TABLE daily_feed_bag_stock ADD COLUMN IF NOT EXISTS source_tag text;
COMMENT ON COLUMN daily_egg_stock_summary.source_tag IS 'NULL = read from a register photo; ''manual entry'' = typed in the app (Enter a day by hand)';
COMMENT ON COLUMN daily_feed_bag_stock.source_tag IS 'NULL = read from a register photo; ''manual entry'' = typed in the app (Enter a day by hand)';
COMMIT;
