-- SKU Packaging Master upload now also captures the "Source" column from
-- the vendor's CSV (informational — where the SKU/packing data originated).
ALTER TABLE sku_packaging_master ADD COLUMN IF NOT EXISTS source VARCHAR(160);
