-- ─────────────────────────────────────────────────────────────────────────
-- Migration 002: Force-Complete support + Expected/Actual qty tracking
-- Safe to re-run: all ALTER TYPE use IF NOT EXISTS
-- ─────────────────────────────────────────────────────────────────────────

-- New roles
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'CC_DP';
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'FC_DP';

-- Force-completed status added to existing enums
ALTER TYPE po_line_status ADD VALUE IF NOT EXISTS 'FORCE_COMPLETED';
ALTER TYPE indent_line_status ADD VALUE IF NOT EXISTS 'FORCE_COMPLETED';
ALTER TYPE issue_status ADD VALUE IF NOT EXISTS 'FORCE_COMPLETED';

-- Force Complete audit fields on the three tables that support it
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS force_completed_by BIGINT REFERENCES users(id);
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS force_completed_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS force_complete_reason TEXT;

ALTER TABLE indent_lines ADD COLUMN IF NOT EXISTS force_completed_by BIGINT REFERENCES users(id);
ALTER TABLE indent_lines ADD COLUMN IF NOT EXISTS force_completed_at TIMESTAMPTZ;
ALTER TABLE indent_lines ADD COLUMN IF NOT EXISTS force_complete_reason TEXT;

ALTER TABLE stock_issues ADD COLUMN IF NOT EXISTS force_completed_by BIGINT REFERENCES users(id);
ALTER TABLE stock_issues ADD COLUMN IF NOT EXISTS force_completed_at TIMESTAMPTZ;
ALTER TABLE stock_issues ADD COLUMN IF NOT EXISTS force_complete_reason TEXT;

-- Expected qty snapshot on stock_issues (indent's remaining qty at time of issue)
ALTER TABLE stock_issues ADD COLUMN IF NOT EXISTS expected_qty NUMERIC(14,3);

-- Expected qty snapshot on stock_receipts (issue's issued_qty at time of receipt)
ALTER TABLE stock_receipts ADD COLUMN IF NOT EXISTS expected_qty NUMERIC(14,3);

-- Reversal support: generic reversal log
CREATE TABLE IF NOT EXISTS admin_reversals (
  id BIGSERIAL PRIMARY KEY,
  admin_user_id BIGINT NOT NULL REFERENCES users(id),
  entity_table VARCHAR(40) NOT NULL,
  entity_id BIGINT NOT NULL,
  action VARCHAR(20) NOT NULL,
  reason TEXT NOT NULL,
  previous_state JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_reversals_entity ON admin_reversals(entity_table, entity_id);
