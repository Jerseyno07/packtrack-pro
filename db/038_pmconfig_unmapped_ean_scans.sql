-- Allow logging a scan for an EAN that has no sku_packaging_master mapping
-- at all. Previously the lookup just 404'd and nothing was recorded — this
-- meant no visibility into which EANs are actually being scanned in the
-- field without an FSN map. sku_code becomes nullable; ean is required at
-- the application layer instead when sku_code is absent (it's the only
-- identifying data in that case). The FK to sku_packaging_master already
-- allows NULL without any further change.
ALTER TABLE sku_validation_scans ALTER COLUMN sku_code DROP NOT NULL;
