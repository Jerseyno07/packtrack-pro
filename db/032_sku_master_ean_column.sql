-- SKU Packaging Master upload now also captures EAN — one EAN per FSN.
ALTER TABLE sku_packaging_master ADD COLUMN IF NOT EXISTS ean VARCHAR(60);
