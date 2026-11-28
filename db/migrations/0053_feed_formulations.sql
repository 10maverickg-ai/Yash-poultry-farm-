-- V19: the nutritionist's feed formulas (Mabestic Consultancy, Dr Bhaskar Choudhary, 28 Nov 2026).
-- ALREADY CREATED AND FILLED IN THE LIVE PROJECT by the owner's side on 28 Nov 2026 (Supabase migration
-- "feed_formulations", 20261128095443). This file is the repository's copy of the same three tables so a local or new
-- database gets them too; every statement is IF NOT EXISTS, so running it against live changes nothing.
-- Additive only: three new tables, nothing else touched. No RLS change (the same as every other table).
--   feed_formulations            one row per formula, with its own effective date and costs per kg
--   feed_formulation_ingredients the formula's ingredients (percent, kg in a 1,000 kg batch, rupees per kg)
--   feed_formulation_sheds       which flocks (by their real name, e.g. 'BAB-1') eat it
-- The app picks, for a flock and a day, the formula that names the flock with the latest effective_from on or before
-- that day; a later row with a later effective_from is picked up with no code change.

BEGIN;
CREATE TABLE IF NOT EXISTS feed_formulations (
  id                      integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  farm_code               text NOT NULL DEFAULT 'YPF',
  code                    text NOT NULL UNIQUE,
  name                    text NOT NULL,
  effective_from          date NOT NULL,
  batch_kg                numeric NOT NULL DEFAULT 1000,
  bag_kg_in_pdf           numeric NOT NULL DEFAULT 50,   -- the PDF prints a per-50-kg column for display; the app's bag is 45 kg (BAG_KG)
  formula_cost_per_kg     numeric NOT NULL,
  production_loss_pct     numeric NOT NULL DEFAULT 1,
  production_cost_per_kg  numeric NOT NULL DEFAULT 1.5,
  bagging_cost_per_kg     numeric NOT NULL DEFAULT 0.9,
  delivered_cost_per_kg   numeric NOT NULL,              -- formula ÷ (1 − loss) + production + bagging
  ame_kcal_per_kg         numeric,
  target_intake_note      text,
  source                  text,
  note                    text,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feed_formulation_ingredients (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  formulation_id  integer NOT NULL REFERENCES feed_formulations(id),
  ingredient      text NOT NULL,
  percent         numeric NOT NULL,
  kg_per_batch    numeric NOT NULL,
  rupees_per_kg   numeric NOT NULL
);

CREATE TABLE IF NOT EXISTS feed_formulation_sheds (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  formulation_id  integer NOT NULL REFERENCES feed_formulations(id),
  flock_label     text NOT NULL
);
COMMIT;
