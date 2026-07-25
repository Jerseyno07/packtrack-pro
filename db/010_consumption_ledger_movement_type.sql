-- Add CONSUMPTION to the ledger movement type enum
ALTER TYPE ledger_movement_type ADD VALUE IF NOT EXISTS 'CONSUMPTION';

-- The old unique constraint (ref_table, ref_id, movement_type) allows only one ledger entry
-- per source document per movement type. CONSUMPTION runs produce one entry per
-- (warehouse, material) group, so we need warehouse_id + material_id in the key.
ALTER TABLE stock_ledger DROP CONSTRAINT stock_ledger_ref_table_ref_id_movement_type_key;
ALTER TABLE stock_ledger ADD CONSTRAINT stock_ledger_ref_unique
  UNIQUE (warehouse_id, material_id, ref_table, ref_id, movement_type);
