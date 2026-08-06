-- Allow zero-qty receipts (e.g. material lost in transit, force-closing issue)
-- Original constraint blocked (0,0,0). Replace with per-column non-negative check.
ALTER TABLE stock_receipts DROP CONSTRAINT chk_receipt_breakdown;
ALTER TABLE stock_receipts ADD CONSTRAINT chk_receipt_breakdown
  CHECK (received_qty >= 0 AND shortage_qty >= 0 AND damage_qty >= 0);
