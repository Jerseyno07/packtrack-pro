-- Add "STO not found" and "Others" as two more Adhoc GRN types.
-- "Others" requires a remarks note — stored in the existing goods_receipts.notes
-- column (already present, unused by the adhoc flow until now) rather than a
-- new column.
ALTER TABLE goods_receipts DROP CONSTRAINT goods_receipts_grn_type_check;
ALTER TABLE goods_receipts
  ADD CONSTRAINT goods_receipts_grn_type_check
    CHECK (grn_type IS NULL OR grn_type IN ('NO_PO_INVOICE', 'DELIVERY_CHALLAN', 'PETTY_CASH', 'PO_NOT_UPLOADED', 'STO_NOT_FOUND', 'OTHERS'));
