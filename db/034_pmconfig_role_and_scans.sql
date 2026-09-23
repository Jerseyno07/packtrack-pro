-- /pmconfig — barcode-scan packing validation view.
-- New role for staff verifying physical packing against sku_packaging_master
-- at the shelf/QC point, Google SSO, same phase-1 pattern as ADMIN/
-- PM_STORE_EXEC/PROCUREMENT.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'PM_CONFIG';

-- Log-only table: every scan submission (confirmed "Same as Bizfin" or a
-- correction) lands here. Never written back to sku_packaging_master —
-- this is purely a validation/audit trail, and also answers "who scanned
-- this EAN and when" when a second person scans the same product later.
CREATE TABLE sku_validation_scans (
  id                BIGSERIAL PRIMARY KEY,
  sku_code          VARCHAR(60) NOT NULL REFERENCES sku_packaging_master(sku_code),
  ean               VARCHAR(60),
  same_as_bizfin    BOOLEAN NOT NULL,
  primary_pm_code   VARCHAR(30) REFERENCES materials(code),
  secondary_pm_code VARCHAR(30) REFERENCES materials(code),
  tertiary_pm_code  VARCHAR(30) REFERENCES materials(code),
  photo_path        VARCHAR(255),
  scanned_by        BIGINT NOT NULL REFERENCES users(id),
  scanned_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sku_validation_scans_sku ON sku_validation_scans(sku_code, scanned_at DESC);
