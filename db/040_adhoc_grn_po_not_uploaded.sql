-- Add "PO not uploaded" as a 4th Adhoc GRN type (goods received but the PO
-- for it hasn't been created/uploaded in Procurement yet — distinct from
-- NO_PO_INVOICE, which is for invoices that never carry a PO number at all).
ALTER TABLE goods_receipts DROP CONSTRAINT goods_receipts_grn_type_check;
ALTER TABLE goods_receipts
  ADD CONSTRAINT goods_receipts_grn_type_check
    CHECK (grn_type IS NULL OR grn_type IN ('NO_PO_INVOICE', 'DELIVERY_CHALLAN', 'PETTY_CASH', 'PO_NOT_UPLOADED'));
