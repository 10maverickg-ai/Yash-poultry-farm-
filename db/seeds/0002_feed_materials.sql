-- Seed: the 28 raw materials, names verbatim from schema spec Table 6a.
-- info/function/notes columns stay null until the Phase 4.5 tooltip feature.

INSERT INTO feed_materials (material_name)
VALUES
    ('Bajra'),
    ('Nakku'),               -- broken rice
    ('D.O.R.B'),
    ('SIF'),                 -- sunflower DOC
    ('Soya'),
    ('Mustard'),
    ('D.D.G.S'),
    ('Fish meal'),
    ('M.B.M'),
    ('Marble Powder'),
    ('Marble Grit'),
    ('Salt'),
    ('Lysine'),
    ('DLM'),
    ('Threonine'),
    ('Soda'),
    ('Enzyme'),
    ('Sod. Formate'),
    ('Betaine'),
    ('Rovimix'),
    ('T.M'),
    ('Moss'),
    ('Haldi'),
    ('Potassium Chloride'),
    ('Sod. Sulphate'),
    ('Toxi Binder'),
    ('Nutri-9'),
    ('Maize')
ON CONFLICT (material_name) DO NOTHING;
