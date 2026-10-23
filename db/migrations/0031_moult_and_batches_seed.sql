-- Migration 0031 (V5 items 7.2, 7.3): the facts the owner has given, as rows in
-- the new tables. Inserted only if the table is empty, so re-running never
-- duplicates. Nothing in an existing table is changed.
BEGIN;

-- BAB-5 (database flock d6b2f7b4…): feed fell to 0 about Aug 15 2026, eggs fell
-- from Aug 17, recovery from early September. Start date is INFERRED from the
-- register, so confirmed_by_owner = false until the owner confirms it.
INSERT INTO moulting_periods (flock_internal_id, start_date, end_date, confirmed_by_owner, note)
SELECT f.flock_internal_id, DATE '2026-08-15', NULL, false,
       'Inferred from the register (feed fell to 0 about Aug 15, eggs fell from Aug 17, recovery from early September). Owner to confirm the start date.'
  FROM flocks f
 WHERE f.flock_internal_id = 'd6b2f7b4-6821-4e6a-8e22-3709f6944eb2'
   AND NOT EXISTS (SELECT 1 FROM moulting_periods);

-- Chick batches (source hatcheries are not known here, so left empty).
INSERT INTO chick_batches (farm_code, arrival_date, source, starting_count, shed_side, status, moved_to_layer_date, to_anil_farm_count, note)
SELECT 'YPF', v.arrival::date, NULL, v.cnt, v.side, v.status, v.moved::date, v.anil, v.note
FROM (VALUES
  ('2026-05-23', 19980, NULL,   'moved_to_layer', '2026-10-01', 0,
   '19,980 chicks. Moved to layer cages about 1 Oct 2026 as "BAB 10 and 11". 737 chicks from the 6 June batch filled its shortfall.'),
  ('2026-06-06', 10000, NULL,   'mixed',          NULL,         9263,
   '10,000 chicks: 9,263 went to Anil farm, 737 filled the shortfall of the 23 May flock. Not Yash farm.'),
  ('2026-09-18', 16000, NULL,   'in_chick_shed',  NULL,         0,
   '16,000 chicks, still in the chick shed. From 19 Sept the register shows them as row 4 "Chicks" (owner: chicks from Anil farm).')
) AS v(arrival, cnt, side, status, moved, anil, note)
WHERE NOT EXISTS (SELECT 1 FROM chick_batches);

COMMIT;
