-- Seed: the two farms, capacities verbatim from schema spec Table 0.
-- total_capacity is computed by the database (Yash 1,30,000 / Anil 70,000).

INSERT INTO farms (farm_code, farm_name, layer_capacity, chick_grower_capacity, typical_filled_layer_count)
VALUES
    ('YPF', 'Yash Poultry Farm', 100000, 30000, 98000),
    ('APF', 'Anil Poultry Farm',  50000, 20000, 48000)
ON CONFLICT (farm_code) DO NOTHING;
