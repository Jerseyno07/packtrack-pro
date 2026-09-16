-- DICE PO Posting API — inbound PO push from DICE/Zaggle.
-- See server/index.js POST /api/v1/external/dice/purchase-orders and the
-- shared spec doc (Obsidian note "21 - DICE PO Posting API Spec").

-- DICE identifies a material by their own item code, not our sku_code.
-- Nullable + partial unique index: most materials won't have one until the
-- initial mapping backfill happens.
ALTER TABLE materials ADD COLUMN IF NOT EXISTS dice_item_code VARCHAR(60);
CREATE UNIQUE INDEX IF NOT EXISTS idx_materials_dice_item_code
  ON materials (dice_item_code) WHERE dice_item_code IS NOT NULL;

-- Distinguishes a DICE-pushed PO line from a CSV-uploaded one. Existing rows
-- backfill to 'CSV_UPLOAD' via the DEFAULT, since every row today came from
-- that path.
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS source VARCHAR(20) NOT NULL DEFAULT 'CSV_UPLOAD';
