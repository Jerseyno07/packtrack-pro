-- Migration 013: widen packaging_tier to accommodate MRP_BARCODE / MRP_WAX_RIBBON values
ALTER TABLE consumption_run_lines ALTER COLUMN packaging_tier TYPE VARCHAR(20);
