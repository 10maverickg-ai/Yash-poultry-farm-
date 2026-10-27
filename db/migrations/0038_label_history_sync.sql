-- Migration 0038 (V8 I1/I5): flock_label_history was never updated when the flocks were renamed to
-- match the register on 2026-10-27 (flocks.display_label changed, the history table kept the old
-- names), so a photo uploaded from 27 Oct would have been matched to the WRONG flock, and BAB-9, 10,
-- 11 had no label at all. This closes every open label row that no longer matches the flock's current
-- display_label (the day before) and opens the current one from 2026-10-27. Past dates keep the labels
-- that were valid then. Departed flocks' open rows end on their depletion date. Idempotent, no deletes.
BEGIN;
UPDATE flock_label_history h
   SET effective_to = CASE WHEN f.status::text = 'depleted' AND f.depletion_date IS NOT NULL THEN f.depletion_date ELSE DATE '2026-10-26' END
  FROM flocks f
 WHERE f.flock_internal_id = h.flock_internal_id
   AND h.effective_to IS NULL
   AND (f.status::text = 'depleted' OR h.display_label <> f.display_label)
   AND h.effective_from < DATE '2026-10-27';
INSERT INTO flock_label_history (flock_internal_id, display_label, effective_from)
SELECT f.flock_internal_id, f.display_label, DATE '2026-10-27'
  FROM flocks f
 WHERE f.status::text = 'active'
   AND NOT EXISTS (SELECT 1 FROM flock_label_history h WHERE h.flock_internal_id = f.flock_internal_id AND h.display_label = f.display_label AND h.effective_to IS NULL);
COMMIT;
