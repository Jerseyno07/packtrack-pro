-- SKU Packaging Master upload now also captures Packing Type (e.g. Bag, Net, Box).
ALTER TABLE sku_packaging_master ADD COLUMN IF NOT EXISTS packing_type VARCHAR(60);
