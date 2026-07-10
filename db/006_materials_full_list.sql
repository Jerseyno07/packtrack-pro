-- Migration 006: Add all packaging materials used in FC/CC operations
-- Existing 3 materials (LDPE-06, NTRLL-01, WXRB-01) are kept as-is
-- to preserve historical ledger data.

INSERT INTO materials (code, name, unit, low_stock_qty, is_active) VALUES
  ('PPT-PULP',    '4pcs Paper Pulp Tray',        'Pcs',  500,   true),
  ('BOX-BIG',     'BOX_BIG',                     'Pcs',  200,   true),
  ('BOX-SML',     'BOX_SMALL',                   'Pcs',  200,   true),
  ('CLNG-01',     'CLING_WRAPPING',               'Roll', 50,    true),
  ('LDPE-1216',   'LDPE 12x16 Inches',            'Pcs',  1000,  true),
  ('LDPE-0608',   'LDPE Bag 6x8 Inches',          'Pcs',  1000,  true),
  ('LDPE-0810',   'LDPE 8x10 Inches',             'Pcs',  1000,  true),
  ('LDPE-0912',   'LDPE 9x12',                    'Pcs',  1000,  true),
  ('LDPE-0916',   'LDPE 9x16',                    'Pcs',  1000,  true),
  ('PPT-PLS',     'Plastic Punnet Tray',           'Pcs',  500,   true),
  ('NTRLL-HRD',   'Hard Net Roll',                'Roll', 20,    true),
  ('NTRLL-SFT',   'Soft Net Roll',                'Roll', 20,    true),
  ('NTRLL-YLW',   'Yellow Soft Net Roll',         'Roll', 20,    true),
  ('NTRLL-RED',   'Cut pieces - Soft Net - RED',  'Pcs',  500,   true),
  ('NTRLL-ULT',   'Ultra Soft Net',               'Roll', 20,    true),
  ('FOAM-RL',     'Foam Roll',                    'Roll', 20,    true),
  ('FOAM-NET',    'Foam Net',                     'Pcs',  500,   true),
  ('BTPR-01',     'Butter Paper',                 'Roll', 20,    true),
  ('BCRL-SML',    'Barcode Roll small',           'Roll', 10,    true),
  ('BCRL-BIG',    'Barcode Roll Big',             'Roll', 10,    true),
  ('WXRB-BLK',    'Wax Ribbon Black',             'Roll', 10,    true),
  ('TAPE-FK',     'FK Tapes',                     'Roll', 30,    true),
  ('FPCH-0912',   'Foam Pouch 9*12',              'Pcs',  500,   true),
  ('FPCH-0910',   'Foam Pouch 9*10',              'Pcs',  500,   true),
  ('BOX-APL',     'Apple Box',                    'Pcs',  100,   true),
  ('BOX-MNG',     'Mango Box',                    'Pcs',  100,   true),
  ('STCK-MRP',    'MRP sticker',                  'Pcs',  1000,  true),
  ('BOX-FKMNG',   'FK Mango Box',                 'Pcs',  100,   true)
ON CONFLICT (code) DO NOTHING;
