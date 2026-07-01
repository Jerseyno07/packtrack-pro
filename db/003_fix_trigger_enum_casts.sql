-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 003: Re-create trigger functions with explicit enum casts
--
-- After ALTER TYPE ... ADD VALUE in migration 002, Postgres invalidated the
-- compiled plans of trigger functions that set enum-typed columns using string
-- literals. This causes: "column status is of type po_line_status but
-- expression is of type text". Fix: CREATE OR REPLACE with explicit ::type casts.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION fn_sync_po_received_qty() RETURNS TRIGGER AS $$
DECLARE
  v_total   NUMERIC(14,3);
  v_po_qty  NUMERIC(14,3);
BEGIN
  SELECT COALESCE(SUM(grn_qty), 0) INTO v_total
    FROM goods_receipts
   WHERE po_id = COALESCE(NEW.po_id, OLD.po_id) AND status = 'POSTED'::grn_status;

  SELECT po_qty INTO v_po_qty
    FROM purchase_orders
   WHERE id = COALESCE(NEW.po_id, OLD.po_id);

  UPDATE purchase_orders
     SET received_qty_cache = v_total,
         status = CASE
                    WHEN v_total >= v_po_qty THEN 'CLOSED'::po_line_status
                    WHEN v_total > 0         THEN 'PARTIALLY_RECEIVED'::po_line_status
                    ELSE                          'OPEN'::po_line_status
                  END,
         updated_at = now()
   WHERE id = COALESCE(NEW.po_id, OLD.po_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION fn_sync_indent_issued_qty() RETURNS TRIGGER AS $$
DECLARE
  v_total     NUMERIC(14,3);
  v_requested NUMERIC(14,3);
BEGIN
  SELECT COALESCE(SUM(issued_qty), 0) INTO v_total
    FROM stock_issues
   WHERE indent_line_id = COALESCE(NEW.indent_line_id, OLD.indent_line_id)
     AND status != 'CANCELLED'::issue_status;

  SELECT requested_qty INTO v_requested
    FROM indent_lines
   WHERE id = COALESCE(NEW.indent_line_id, OLD.indent_line_id);

  UPDATE indent_lines
     SET issued_qty = v_total,
         status = CASE
                    WHEN v_total >= v_requested THEN 'FULLY_ISSUED'::indent_line_status
                    WHEN v_total > 0            THEN 'PARTIALLY_ISSUED'::indent_line_status
                    ELSE                             'PENDING'::indent_line_status
                  END,
         updated_at = now()
   WHERE id = COALESCE(NEW.indent_line_id, OLD.indent_line_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
