-- Migration 017: Separate consumption rate from roll length; butter paper in pieces
-- consumption_rate: meters deducted per unit packaged (used by scraper) = 0.55
-- meters_per_unit stays = 1000 (display: DB meters → rolls)
ALTER TABLE materials ADD COLUMN IF NOT EXISTS consumption_rate NUMERIC;
UPDATE materials SET consumption_rate = 0.55
WHERE meters_per_unit IS NOT NULL AND stickers_per_roll IS NULL;

-- Butter paper: vendor delivers in kg (350 pcs/kg); DB stores and tracks in pieces
ALTER TABLE materials ADD COLUMN IF NOT EXISTS pieces_per_kg NUMERIC;
UPDATE materials SET pieces_per_kg = 350, unit = 'Pcs' WHERE code = 'BTPR-01';
