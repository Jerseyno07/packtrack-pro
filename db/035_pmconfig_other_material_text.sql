-- /pmconfig correction fields: the materials PackTrack knows about may not
-- cover what's actually on the shelf. Adds an "Others" option per tier —
-- when picked, the code column stays null and the free-text description
-- goes here instead.
ALTER TABLE sku_validation_scans
  ADD COLUMN primary_pm_other VARCHAR(200),
  ADD COLUMN secondary_pm_other VARCHAR(200),
  ADD COLUMN tertiary_pm_other VARCHAR(200);
