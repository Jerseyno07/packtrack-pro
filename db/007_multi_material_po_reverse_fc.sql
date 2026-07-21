-- ─────────────────────────────────────────────────────────────────────────
-- Migration 007: Multi-material POs + reverse-force-complete support
--
-- 1. A single PO number can now cover multiple packaging materials
--    (one row per material, grouped by po_no). Uniqueness moves from
--    po_no alone to (po_no, material_id) — same material can't appear
--    twice under the same PO, but different materials can share a po_no.
--
-- 2. Partial GRN (inward less than the full remaining PO qty) is now a
--    normal, allowed operation at the application layer — this migration
--    doesn't need a schema change for that (PARTIALLY_RECEIVED already
--    exists on po_line_status and the sync trigger already handles it),
--    but is documented here since it ships alongside this migration.
--
-- 3. Reverse-force-complete audit trail piggybacks on the existing
--    admin_reversals table (added in migration 002) — no new table needed.
-- ─────────────────────────────────────────────────────────────────────────

-- Drop the old single-column uniqueness on po_no...
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_po_no_key;

-- ...replace with a composite constraint: same po_no can repeat across
-- material lines, but not for the same material twice under one PO.
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_po_no_material_key UNIQUE (po_no, material_id);

-- po_no is no longer globally unique, so index it explicitly for the
-- "group GRN candidates by po_no" lookups the UI now does.
CREATE INDEX IF NOT EXISTS idx_po_po_no ON purchase_orders(po_no);

-- admin_reversals.action was VARCHAR(20) which is too short for
-- 'REVERSE_FORCE_COMPLETE' (22 chars). Widen to 50.
ALTER TABLE admin_reversals ALTER COLUMN action TYPE VARCHAR(50);
