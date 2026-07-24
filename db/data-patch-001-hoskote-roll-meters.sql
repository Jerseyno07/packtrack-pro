-- Data Patch 001: Correct Hoskote roll material quantities from rolls → meters
-- Date: 2026-07-24
-- Context: Indent upload stored no_of_rolls directly instead of no_of_rolls × length_per_roll.
--          All downstream records (stock_issues, stock_receipts, stock_ledger) are also wrong.
--
-- Corrections (user-verified correct values in meters):
--   NTRLL-HRD:  5 rolls  →  5000 m   (indent_line 13, issue 10, receipt 9,  ledger 38/43)
--   NTRLL-SFT:  5 rolls  →  5000 m   (indent_line 14, issue  7, receipt 7,  ledger 32/35)
--   BCRL-SML:  150 rolls → 150000 m  (indent_line 16, issue  8, receipt 6,  ledger 33/34)
--   WXRB-BLK:  315 rolls → 315000 m  (indent_line 17, issue  9, receipt 8,  ledger 36/37)

BEGIN;

-- indent_lines
UPDATE indent_lines SET requested_qty = 5000,  issued_qty = 5000  WHERE id = 13;
UPDATE indent_lines SET requested_qty = 5000,  issued_qty = 5000  WHERE id = 14;
UPDATE indent_lines SET requested_qty = 150000, issued_qty = 150000 WHERE id = 16;
UPDATE indent_lines SET requested_qty = 315000, issued_qty = 315000 WHERE id = 17;

-- stock_issues
UPDATE stock_issues SET issued_qty = 5000,  expected_qty = 5000  WHERE id = 10;
UPDATE stock_issues SET issued_qty = 5000,  expected_qty = 5000  WHERE id = 7;
UPDATE stock_issues SET issued_qty = 150000, expected_qty = 150000 WHERE id = 8;
UPDATE stock_issues SET issued_qty = 315000, expected_qty = 315000 WHERE id = 9;

-- stock_receipts (no shortage in any case, so received_qty = issued_qty)
UPDATE stock_receipts SET received_qty = 5000,  expected_qty = 5000  WHERE id = 9;
UPDATE stock_receipts SET received_qty = 5000,  expected_qty = 5000  WHERE id = 7;
UPDATE stock_receipts SET received_qty = 150000, expected_qty = 150000 WHERE id = 6;
UPDATE stock_receipts SET received_qty = 315000, expected_qty = 315000 WHERE id = 8;

-- stock_ledger — ISSUE_OUT (negative deltas)
UPDATE stock_ledger SET qty_delta = -5000  WHERE id = 38;
UPDATE stock_ledger SET qty_delta = -5000  WHERE id = 32;
UPDATE stock_ledger SET qty_delta = -150000 WHERE id = 33;
UPDATE stock_ledger SET qty_delta = -315000 WHERE id = 36;

-- stock_ledger — RECEIPT_IN (positive deltas)
UPDATE stock_ledger SET qty_delta = 5000  WHERE id = 43;
UPDATE stock_ledger SET qty_delta = 5000  WHERE id = 35;
UPDATE stock_ledger SET qty_delta = 150000 WHERE id = 34;
UPDATE stock_ledger SET qty_delta = 315000 WHERE id = 37;

COMMIT;
