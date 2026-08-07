-- Dispatch qty is capped by PM store stock, not by the indent's requested_qty.
-- A line can be over-dispatched vs the original request if stock is available.
ALTER TABLE indent_lines DROP CONSTRAINT IF EXISTS chk_issued_not_exceed_requested;
