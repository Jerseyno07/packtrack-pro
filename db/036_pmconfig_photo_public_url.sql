-- Scan photos now upload to a dedicated public R2 bucket (packtrack-pmconfig-photos)
-- instead of the shared private bucket, so leadership can open the link directly
-- from an exported spreadsheet with no login and no expiry. photo_path (the R2
-- object key) is kept for internal reference; photo_url is the permanent,
-- ready-to-paste link.
ALTER TABLE sku_validation_scans
  ADD COLUMN photo_url VARCHAR(500);
