-- 018_indent_lifecycle_view.sql
-- Analytics view: full indent lifecycle from upload → dispatch → receipt.
-- One row per indent line. Quantities in display units (rolls / pcs / kg).
-- Raw base quantities (meters / pieces) included with _base suffix for cross-checks.
-- Run against the Neon DB: psql $DATABASE_URL -f 018_indent_lifecycle_view.sql

CREATE OR REPLACE VIEW v_indent_lifecycle AS
SELECT
  il.id                                   AS indent_line_id,
  il.indent_ref                           AS indent_id,
  m.code                                  AS sku_code,
  m.name                                  AS sku_name,

  -- Display-unit quantities
  CASE
    WHEN m.meters_per_unit    IS NOT NULL THEN ROUND(il.requested_qty / m.meters_per_unit,    2)
    WHEN m.stickers_per_roll  IS NOT NULL THEN ROUND(il.requested_qty / m.stickers_per_roll,  2)
    WHEN m.pieces_per_kg      IS NOT NULL THEN ROUND(il.requested_qty / m.pieces_per_kg,      3)
    ELSE il.requested_qty
  END                                     AS indent_qty,

  CASE
    WHEN m.meters_per_unit    IS NOT NULL THEN ROUND(il.issued_qty / m.meters_per_unit,    2)
    WHEN m.stickers_per_roll  IS NOT NULL THEN ROUND(il.issued_qty / m.stickers_per_roll,  2)
    WHEN m.pieces_per_kg      IS NOT NULL THEN ROUND(il.issued_qty / m.pieces_per_kg,      3)
    ELSE il.issued_qty
  END                                     AS issued_qty,

  CASE
    WHEN m.meters_per_unit    IS NOT NULL THEN ROUND(COALESCE(rcpt.total_received, 0) / m.meters_per_unit,   2)
    WHEN m.stickers_per_roll  IS NOT NULL THEN ROUND(COALESCE(rcpt.total_received, 0) / m.stickers_per_roll, 2)
    WHEN m.pieces_per_kg      IS NOT NULL THEN ROUND(COALESCE(rcpt.total_received, 0) / m.pieces_per_kg,     3)
    ELSE COALESCE(rcpt.total_received, 0)
  END                                     AS received_qty,

  CASE
    WHEN m.meters_per_unit   IS NOT NULL THEN 'rolls'
    WHEN m.stickers_per_roll IS NOT NULL THEN 'units'
    WHEN m.pieces_per_kg     IS NOT NULL THEN 'Kg'
    ELSE m.unit
  END                                     AS uom,

  -- Raw base quantities (meters / pieces) — useful for audits and cross-checks
  il.requested_qty                        AS indent_qty_base,
  il.issued_qty                           AS issued_qty_base,
  COALESCE(rcpt.total_received, 0)        AS received_qty_base,

  -- Deltas (in base units)
  il.requested_qty - il.issued_qty                              AS unissued_base,
  il.issued_qty    - COALESCE(rcpt.total_received, 0)           AS unreceived_base,

  -- Facilities
  fw.name                                 AS from_facility,
  fw.code                                 AS from_facility_code,
  tw.name                                 AS to_facility,
  tw.code                                 AS to_facility_code,

  -- Status
  il.status                               AS indent_status,
  il.indent_date,

  -- Lifecycle timestamps
  il.created_at                           AS indent_upload_ts,
  iss.first_issued_at                     AS indent_issued_ts,
  rcpt.first_received_at                  AS indent_received_ts,

  -- Lag metrics (useful for SLA reporting)
  EXTRACT(EPOCH FROM (iss.first_issued_at  - il.created_at))  / 3600 AS hours_to_first_dispatch,
  EXTRACT(EPOCH FROM (rcpt.first_received_at - iss.first_issued_at)) / 3600 AS hours_dispatch_to_receipt

FROM indent_lines il
JOIN materials  m  ON m.id  = il.material_id
JOIN warehouses tw ON tw.id = il.warehouse_id

-- First dispatch per indent line (for from_facility and issued timestamp)
LEFT JOIN LATERAL (
  SELECT
    MIN(si.created_at)        AS first_issued_at,
    MIN(si.from_warehouse_id) AS from_warehouse_id   -- PM Store; same for every row
  FROM stock_issues si
  WHERE si.indent_line_id = il.id
    AND si.status != 'CANCELLED'
) iss ON true

LEFT JOIN warehouses fw ON fw.id = iss.from_warehouse_id

-- Receipt totals and first receipt timestamp per indent line
LEFT JOIN LATERAL (
  SELECT
    SUM(sr.received_qty)    AS total_received,
    MIN(sr.created_at)      AS first_received_at
  FROM stock_receipts sr
  JOIN stock_issues si ON si.id = sr.stock_issue_id
  WHERE si.indent_line_id = il.id
    AND si.status != 'CANCELLED'
) rcpt ON true;

-- Usage examples:
--
-- Full lifecycle for last 30 days:
--   SELECT * FROM v_indent_lifecycle WHERE indent_date >= now() - INTERVAL '30 days' ORDER BY indent_upload_ts DESC;
--
-- Only dispatched but not yet received (in-transit):
--   SELECT * FROM v_indent_lifecycle WHERE indent_status IN ('FULLY_ISSUED','PARTIALLY_ISSUED') AND received_qty = 0;
--
-- Delta: indent vs dispatch, by SKU:
--   SELECT sku_code, sku_name, SUM(indent_qty) AS total_indented, SUM(issued_qty) AS total_dispatched,
--          SUM(indent_qty - issued_qty) AS shortfall FROM v_indent_lifecycle GROUP BY 1,2 ORDER BY shortfall DESC;
--
-- SLA report (avg hours from upload to first dispatch, by facility):
--   SELECT to_facility, ROUND(AVG(hours_to_first_dispatch)::numeric, 1) AS avg_hrs_to_dispatch
--   FROM v_indent_lifecycle WHERE hours_to_first_dispatch IS NOT NULL GROUP BY 1 ORDER BY 2;
