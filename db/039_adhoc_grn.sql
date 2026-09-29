-- Adhoc GRN: PM Store can now record a goods receipt with no PO yet
-- (invoice without a PO number, a delivery challan, or a petty-cash
-- purchase). Procurement later attaches the real PO once it exists.
--
-- goods_receipts.po_id was NOT NULL — the whole received-qty/PO-status
-- sync trigger (trg_grn_sync_po / fn_sync_po_received_qty) already keys
-- off COALESCE(NEW.po_id, OLD.po_id), so an adhoc row just needs po_id
-- to be nullable at creation; "mapping" is a plain UPDATE that sets it,
-- and the existing trigger does the received_qty_cache/status sync with
-- no further changes needed anywhere downstream.
ALTER TABLE goods_receipts
  ALTER COLUMN po_id DROP NOT NULL,
  ALTER COLUMN unit_price DROP NOT NULL,  -- adhoc has no PO price to snapshot
  ADD COLUMN vendor_name VARCHAR(160),    -- only set on adhoc rows; PO-matched rows derive vendor via the PO join
  ADD COLUMN grn_type VARCHAR(30)
    CHECK (grn_type IS NULL OR grn_type IN ('NO_PO_INVOICE', 'DELIVERY_CHALLAN', 'PETTY_CASH'));

-- Explicit NULL guard instead of relying on the implicit no-op of
-- `WHERE id = NULL` when an adhoc row (po_id IS NULL) is inserted/updated.
-- Everything else here is an exact copy of the live function
-- (confirmed via pg_get_functiondef before writing this migration) —
-- only the new IF wrapper is added, no other behavior changes.
CREATE OR REPLACE FUNCTION public.fn_sync_po_received_qty()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_total   NUMERIC(14,3);
  v_po_qty  NUMERIC(14,3);
BEGIN
  IF COALESCE(NEW.po_id, OLD.po_id) IS NULL THEN
    RETURN NEW;
  END IF;

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
$function$;
