-- Migration 0030 (V5 item 5.1): the cost figures the owner has given, as
-- effective-dated settings. Inserted only if cost_settings is empty, so
-- re-running never duplicates. Labour and packing are "about" figures.
BEGIN;
INSERT INTO cost_settings (farm_code, cost_type, value, unit, effective_from, month, note)
SELECT 'YPF', v.cost_type, v.value, v.unit, v.effective_from::date, v.month, v.note
FROM (VALUES
  ('feed_per_kg',      30,      'INR/kg',    '2026-08-01', NULL,      'Own mill; 1 bag = 45 kg = INR 1,350'),
  ('labour_month',     250000,  'INR/month', '2026-08-01', NULL,      'About INR 2,50,000 per month (estimate)'),
  ('packing_per_tray', 4,       'INR/tray',  '2026-08-01', NULL,      'About INR 4 per tray sold (estimate); trays = eggs sold / 30'),
  ('electricity_month',100000,  'INR/month', '2026-08-01', '2026-08', 'August electricity bill')
) AS v(cost_type, value, unit, effective_from, month, note)
WHERE NOT EXISTS (SELECT 1 FROM cost_settings);
COMMIT;
