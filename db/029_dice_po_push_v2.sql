-- DICE PO Posting API v2 — UOM/services contract change + mapping-limbo
-- retry queue + raw call archive. See server/index.js
-- POST /api/v1/external/dice/purchase-orders and Obsidian note
-- "21 - DICE PO Posting API Spec" (v2 section) for the full contract.

-- Unmapped item_code lines are queued here instead of being a transient
-- REJECTED response — a PackTrack admin retries once the material is
-- mapped (PATCH /api/v1/materials/:id). Rows are never deleted; resolved
-- rows stay as an audit trail with status='RESOLVED'.
CREATE TABLE dice_po_push_pending (
  id                         BIGSERIAL PRIMARY KEY,
  po_no                      VARCHAR(60) NOT NULL,
  vendor_name                VARCHAR(160) NOT NULL,
  po_date                    DATE NOT NULL,
  expected_delivery          DATE,
  pm_store_code              VARCHAR(20) NOT NULL,
  item_code                  VARCHAR(60) NOT NULL,
  qty                        NUMERIC(14,3) NOT NULL,
  uom                        VARCHAR(10) NOT NULL,
  unit_price                 NUMERIC(12,2) NOT NULL,
  status                     VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RESOLVED')),
  retry_count                INT NOT NULL DEFAULT 0,
  last_error                 TEXT,
  last_retried_at            TIMESTAMPTZ,
  last_retried_by            BIGINT REFERENCES users(id),
  resolved_purchase_order_id BIGINT REFERENCES purchase_orders(id),
  created_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_dice_pending_status ON dice_po_push_pending(status);

-- Raw-payload archive for every inbound call, independent of the
-- operational tables above — full forensic copy in case of a dispute or
-- the need to replay/debug what DICE actually sent. The JSON body itself
-- lives in R2 (same object-storage pattern as the CSV upload's source
-- file); this table just indexes the R2 key with per-call summary counts.
CREATE TABLE dice_po_push_calls (
  id               BIGSERIAL PRIMARY KEY,
  r2_key           VARCHAR(255) NOT NULL,
  po_count         INT NOT NULL,
  item_count       INT NOT NULL,
  created_count    INT NOT NULL,
  duplicate_count  INT NOT NULL,
  rejected_count   INT NOT NULL,
  pending_count    INT NOT NULL,
  ignored_count    INT NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
