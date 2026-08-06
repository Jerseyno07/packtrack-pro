-- Migration 016: Fix meters_per_unit for all net-roll / cling-wrap materials
-- Each roll is 1000 meters. The previous placeholder value (0.5) was wrong.
-- DB always stores quantities in meters; divide by meters_per_unit to display in rolls.
UPDATE materials
SET meters_per_unit = 1000
WHERE meters_per_unit IS NOT NULL
  AND stickers_per_roll IS NULL;
