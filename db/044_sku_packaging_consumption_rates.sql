-- FSN-level consumption rates (meters deducted per packed unit), one per
-- tier, overriding materials.consumption_rate for that specific FSN+PM pair.
-- NULL = no FSN-specific rate uploaded yet; scraper falls back to the
-- material's global consumption_rate. Scoped to meters-based roll materials
-- only (net roll, cling wrap, foam roll, foam net) — sticker-roll materials
-- (barcode/wax ribbon) keep their separate fixed MRP deduction pass.
ALTER TABLE sku_packaging_master
  ADD COLUMN IF NOT EXISTS primary_consumption_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS secondary_consumption_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS tertiary_consumption_rate NUMERIC;
