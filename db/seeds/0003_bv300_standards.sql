-- Seed: BV300 breed standards, verbatim from bv300-standards-reference.md
-- (owner-compiled from Venky's "BV300 Nutrition and Management Guide 2023").
-- guide_version keys everything; a future guide is new rows, not an update.

-- Table A: rearing period — body weight & feed consumption by week (0-18 wks)
INSERT INTO bv300_standard_rearing
    (guide_version, week, target_body_weight_g, body_weight_min_g, body_weight_max_g, feed_per_day_g, stage)
VALUES
    ('2023',  1,   65,   60,   70,  8, 'Chick'),
    ('2023',  2,  110,  100,  120, 16, 'Chick'),
    ('2023',  3,  165,  150,  180, 25, 'Chick'),
    ('2023',  4,  235,  215,  255, 34, 'Chick'),
    ('2023',  5,  315,  290,  340, 44, 'Chick'),
    ('2023',  6,  400,  375,  425, 48, 'Chick'),
    ('2023',  7,  490,  460,  520, 44, 'Grower'),
    ('2023',  8,  580,  550,  610, 48, 'Grower'),
    ('2023',  9,  665,  630,  700, 49, 'Grower'),
    ('2023', 10,  750,  710,  790, 50, 'Grower'),
    ('2023', 11,  825,  780,  870, 51, 'Developer'),
    ('2023', 12,  890,  840,  940, 54, 'Developer'),
    ('2023', 13,  950,  900, 1000, 56, 'Developer'),
    ('2023', 14, 1000,  950, 1050, 58, 'Developer'),
    ('2023', 15, 1050, 1000, 1100, 60, 'Developer'),
    ('2023', 16, 1105, 1050, 1160, 62, 'Pre-lay'),
    ('2023', 17, 1170, 1110, 1230, 63, 'Pre-lay'),
    ('2023', 18, 1240, 1180, 1300, 66, 'Phase-1 (layer feed starts)')
ON CONFLICT (guide_version, week) DO NOTHING;

-- Table B: laying period — performance objectives by week (19-100 wks).
-- Source doc is condensed to ~5-week steps (full week-by-week table can be
-- added as extra rows later). cumulative_depletion_percent only where the
-- source states it: ~0 at wk 19, 3.1 by 60, 6.0 by 80, 9.0 by 100.
INSERT INTO bv300_standard_laying
    (guide_version, age_weeks, std_hdp_percent, feed_per_day_g, feed_per_egg_g,
     egg_weight_g, body_weight_g, cumulative_depletion_percent)
VALUES
    ('2023',  19, 25.0,  80, 320, 42.5, 1300, 0.0),
    ('2023',  20, 50.0,  85, 220, 45.0, 1350, NULL),
    ('2023',  22, 90.0,  95, 146, 50.0, 1400, NULL),
    ('2023',  25, 96.0, 105, 126, 54.0, 1440, NULL),
    ('2023',  30, 98.0, 110, 119, 56.2, 1490, NULL),
    ('2023',  35, 97.7, 110, 117, 56.8, 1515, NULL),
    ('2023',  40, 96.9, 111, 116, 57.3, 1529, NULL),
    ('2023',  45, 95.9, 112, 116, 57.8, 1535, NULL),
    ('2023',  50, 94.7, 112, 116, 58.2, 1540, NULL),
    ('2023',  55, 93.4, 112, 117, 58.5, 1545, NULL),
    ('2023',  60, 91.9, 113, 117, 58.7, 1550, 3.1),
    ('2023',  65, 90.3, 113, 118, 59.0, 1553, NULL),
    ('2023',  70, 88.6, 114, 119, 59.2, 1555, NULL),
    ('2023',  75, 86.8, 114, 120, 59.5, 1558, NULL),
    ('2023',  80, 84.9, 114, 121, 59.7, 1560, 6.0),
    ('2023',  85, 82.9, 114, 122, 59.9, 1563, NULL),
    ('2023',  90, 80.6, 114, 123, 60.2, 1565, NULL),
    ('2023',  95, 78.1, 114, 124, 60.4, 1568, NULL),
    ('2023', 100, 75.3, 114, 125, 60.7, 1570, 9.0)
ON CONFLICT (guide_version, age_weeks) DO NOTHING;

-- Table C: whole-cycle performance goals — Phase 4 dashboard targets.
INSERT INTO bv300_cycle_goals (guide_version, metric, standard_value)
VALUES
    ('2023', 'Livability, rearing (0–18 wks)',   '96–98%'),
    ('2023', 'Livability, laying (19–80 wks)',   '93%'),
    ('2023', 'Livability, laying (19–100 wks)',  '91%'),
    ('2023', 'Feed intake, 0–18 wks',            '5.6 kg total'),
    ('2023', 'Feed intake, 19–80 wks',           '46.5 kg total'),
    ('2023', 'Feed intake, 19–100 wks',          '61.2 kg total'),
    ('2023', 'Age at 50% rate of lay',           '20 weeks'),
    ('2023', 'Age at 90% rate of lay',           '22 weeks'),
    ('2023', 'Peak production',                  '98%'),
    ('2023', 'Weeks sustained above 90%',        '45 weeks'),
    ('2023', 'Total hen-housed eggs, 72 wks',    '340'),
    ('2023', 'Total hen-housed eggs, 80 wks',    '386'),
    ('2023', 'Total hen-housed eggs, 100 wks',   '490'),
    ('2023', 'Feed conversion, 19–80 wks',       '121 g feed/egg'),
    ('2023', 'Feed conversion, 19–100 wks',      '125 g feed/egg'),
    ('2023', 'Body weight at 16 wks',            '1.10 kg'),
    ('2023', 'Body weight at 22 wks',            '1.40 kg'),
    ('2023', 'Body weight at 32 wks',            '1.50 kg'),
    ('2023', 'Body weight at 100 wks',           '1.57 kg')
ON CONFLICT (guide_version, metric) DO NOTHING;

-- Table E: drinking water quality — reference checklist only.
INSERT INTO bv300_water_quality (guide_version, parameter, recommended)
VALUES
    ('2023', 'pH',                    '6.5–7.5'),
    ('2023', 'Total bacteria count',  '<50 CFU/ml'),
    ('2023', 'Total coliform',        '0 CFU/ml'),
    ('2023', 'Total dissolved solids','<1000 ppm'),
    ('2023', 'Total hardness',        '60–180 ppm')
ON CONFLICT (guide_version, parameter) DO NOTHING;
