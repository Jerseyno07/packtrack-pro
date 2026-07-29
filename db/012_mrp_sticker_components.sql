-- Migration 012: MRP sticker component tracking
-- Barcode rolls and wax ribbon are now tracked in sticker/label counts, not meters.
-- stickers_per_roll defines how many labels/prints one roll yields (configurable).

ALTER TABLE materials ADD COLUMN IF NOT EXISTS stickers_per_roll INT;

UPDATE materials SET stickers_per_roll = 1000 WHERE code = 'BCRL-SML';
UPDATE materials SET stickers_per_roll = 5000 WHERE code = 'BCRL-BIG';
UPDATE materials SET stickers_per_roll = 5000 WHERE code = 'WXRB-BLK';

-- These materials are tracked in sticker counts, not meters
UPDATE materials SET meters_per_unit = NULL WHERE code IN ('BCRL-SML', 'BCRL-BIG', 'WXRB-BLK');

-- Retire STCK-MRP: remove from all sku_packaging_master mappings
UPDATE sku_packaging_master SET primary_pm_code   = NULL WHERE primary_pm_code   = 'STCK-MRP';
UPDATE sku_packaging_master SET secondary_pm_code = NULL WHERE secondary_pm_code = 'STCK-MRP';
UPDATE sku_packaging_master SET tertiary_pm_code  = NULL WHERE tertiary_pm_code  = 'STCK-MRP';

-- Mark STCK-MRP inactive (superseded by component tracking)
UPDATE materials SET is_active = FALSE WHERE code = 'STCK-MRP';
