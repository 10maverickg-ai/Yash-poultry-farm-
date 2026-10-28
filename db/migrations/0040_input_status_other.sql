-- Migration 0040 (V9 J2): the monthly checklist also asks about "other costs" (repairs, transport, vet visits).
-- Allows the key 'other' in monthly_input_status. Only widens a CHECK; no data changes.
BEGIN;
ALTER TABLE monthly_input_status DROP CONSTRAINT IF EXISTS monthly_input_status_input_key_check;
ALTER TABLE monthly_input_status ADD CONSTRAINT monthly_input_status_input_key_check CHECK (input_key IN ('electricity','diesel','medicines','labour','packing','other'));
COMMIT;
