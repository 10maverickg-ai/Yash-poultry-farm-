-- Migration 0044 (V12 N6): who got the eggs. Additive: one nullable text column on sales and a backfill of that new column only.
-- Prices are NOT touched (a sale to a Yash P.F. farm stays priced at the day's selling price, like a Farmfresh sale).
-- Values: farmfresh | local | yash_12 | yash_13 | yash_14 | yash_farms (several of the three together) | anil | other
BEGIN;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS recipient text;
COMMENT ON COLUMN sales.recipient IS 'Who got the eggs: farmfresh, local, yash_12, yash_13, yash_14, yash_farms (several Yash P.F. farms in one line), anil, other. Does not change the price.';
UPDATE sales s SET recipient = 'yash_farms'
  FROM daily_egg_stock_entries e
 WHERE s.recipient IS NULL AND s.source_ledger_entry_id = e.id AND e.label_as_written ~* 'yash\s*p\.?\s*f';
UPDATE sales SET recipient = 'farmfresh' WHERE recipient IS NULL AND (transaction_type::text = 'sale_farmfresh' OR buyer_or_recipient ILIKE '%farm%fresh%');
UPDATE sales SET recipient = 'local' WHERE recipient IS NULL AND transaction_type::text IN ('other','local');
UPDATE sales SET recipient = 'other' WHERE recipient IS NULL;
COMMIT;
