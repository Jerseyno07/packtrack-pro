-- 019_audit_lifecycle_view.sql
-- Analytics view: one row per audit line (facility × material × audit event).
-- Quantities in display units (rolls / units / pcs). Raw base quantities included.
-- Run: psql $DATABASE_URL -f 019_audit_lifecycle_view.sql

CREATE OR REPLACE VIEW v_audit_lifecycle AS
SELECT
  ae.audit_ref,
  w.code                                    AS facility_code,
  w.name                                    AS facility_name,
  ae.audit_date,
  ae.created_at                             AS audit_conducted_at,
  m.code                                    AS sku_code,
  m.name                                    AS sku_name,

  -- Display-unit quantities
  CASE
    WHEN m.meters_per_unit   IS NOT NULL THEN ROUND(ael.system_qty   / m.meters_per_unit,   2)
    WHEN m.stickers_per_roll IS NOT NULL THEN ROUND(ael.system_qty   / m.stickers_per_roll, 2)
    WHEN m.pieces_per_kg     IS NOT NULL THEN ROUND(ael.system_qty   / m.pieces_per_kg,     3)
    ELSE ael.system_qty
  END                                       AS expected_qty,

  CASE
    WHEN m.meters_per_unit   IS NOT NULL THEN ROUND(ael.physical_qty / m.meters_per_unit,   2)
    WHEN m.stickers_per_roll IS NOT NULL THEN ROUND(ael.physical_qty / m.stickers_per_roll, 2)
    WHEN m.pieces_per_kg     IS NOT NULL THEN ROUND(ael.physical_qty / m.pieces_per_kg,     3)
    ELSE ael.physical_qty
  END                                       AS audit_qty,

  CASE
    WHEN m.meters_per_unit   IS NOT NULL THEN ROUND(ael.delta / m.meters_per_unit,   2)
    WHEN m.stickers_per_roll IS NOT NULL THEN ROUND(ael.delta / m.stickers_per_roll, 2)
    WHEN m.pieces_per_kg     IS NOT NULL THEN ROUND(ael.delta / m.pieces_per_kg,     3)
    ELSE ael.delta
  END                                       AS delta,

  CASE
    WHEN m.meters_per_unit   IS NOT NULL THEN 'rolls'
    WHEN m.stickers_per_roll IS NOT NULL THEN 'units'
    WHEN m.pieces_per_kg     IS NOT NULL THEN 'Kg'
    ELSE m.unit
  END                                       AS uom,

  -- Raw base quantities (meters / pieces)
  ael.system_qty                            AS expected_qty_base,
  ael.physical_qty                          AS audit_qty_base,
  ael.delta                                 AS delta_base,

  ael.remark,
  ae.remarks                                AS audit_remarks,
  u.email                                   AS conducted_by

FROM audit_entry_lines ael
JOIN audit_entries ae ON ae.id   = ael.audit_entry_id
JOIN warehouses    w  ON w.id    = ae.warehouse_id
JOIN materials     m  ON m.id    = ael.material_id
JOIN users         u  ON u.id    = ae.conducted_by;

-- Usage examples:
--
-- All audits across all facilities:
--   SELECT * FROM v_audit_lifecycle ORDER BY audit_conducted_at DESC;
--
-- Only lines with a discrepancy:
--   SELECT * FROM v_audit_lifecycle WHERE delta <> 0 ORDER BY ABS(delta_base) DESC;
--
-- Discrepancy summary by facility:
--   SELECT facility_code, facility_name, COUNT(*) FILTER (WHERE delta <> 0) AS discrepancy_lines,
--          COUNT(*) AS total_lines
--   FROM v_audit_lifecycle GROUP BY 1, 2 ORDER BY discrepancy_lines DESC;
--
-- Discrepancy summary by SKU:
--   SELECT sku_code, sku_name, SUM(delta) AS net_delta, uom
--   FROM v_audit_lifecycle GROUP BY 1, 2, 4 ORDER BY ABS(SUM(delta)) DESC;
