-- Migration 0041 (V9 J9): a flock's segment can be cleared back to "not set" from the Flocks screen; the history
-- row for that move stores NULL (the CHECK still only allows main/young when a value is present). No data changes.
BEGIN;
ALTER TABLE flock_segment_history ALTER COLUMN segment DROP NOT NULL;
COMMIT;
