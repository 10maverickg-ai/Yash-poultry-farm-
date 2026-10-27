-- Migration 0039 (V8 I1): the July and October sales rows were loaded with source_ledger_entry_id set,
-- but the ledger lines they came from kept linked_sale_id NULL. The Sales page therefore listed all 27
-- July and all 22 October ledger sales as "waiting for a rate" (1,920,270 and 1,608,960 eggs) although
-- every one has a priced sales row, and editing such a line could have created a duplicate sale.
-- Link each ledger line to its sales row. Idempotent; changes only NULL links.
BEGIN;
UPDATE daily_egg_stock_entries e
   SET linked_sale_id = s.id
  FROM sales s
 WHERE s.source_ledger_entry_id = e.id
   AND e.linked_sale_id IS NULL;
COMMIT;
