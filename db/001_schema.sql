-- ═══════════════════════════════════════════════════════════════════════════
-- PackTrack Production Schema — Postgres 14+
-- (Free-tier friendly: works as-is on Neon, Supabase, Railway, or local Postgres)
--
-- Modules: (1) Indent Upload (CSV/Excel, facility+SKU+date wise)
--          (2) PO Upload (CSV/Excel, for PM Store inward)
--          (3) PM Store Inward / GRN (against uploaded PO)
--          (4) Issue against Indent
--          (5) CC/FC Receipt Confirmation
--          (6) PM Store Exec Dashboard (views only, no new tables)
--
-- Design principles:
--   - Append-only stock_ledger (never mutate "current stock")
--   - Indents AND POs both follow the same batch-upload -> line-item pattern
--   - Real auth: users table with hashed passwords + sessions
--   - Idempotent writes via idempotency_keys (kept for future API integrations)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";        -- gen_random_uuid(), crypt() for password hashing

-- ─────────────────────────────────────────────────────────────────────────
-- ENUMS
-- ─────────────────────────────────────────────────────────────────────────
CREATE TYPE warehouse_type AS ENUM ('PM_STORE', 'CC', 'FC');
CREATE TYPE user_role AS ENUM ('ADMIN', 'PM_STORE_EXEC', 'CC_EXEC', 'FC_EXEC');

CREATE TYPE upload_batch_status AS ENUM ('UPLOADED', 'VALIDATED', 'PARTIALLY_FAILED', 'FAILED');
CREATE TYPE indent_line_status AS ENUM ('PENDING', 'PARTIALLY_ISSUED', 'FULLY_ISSUED', 'CANCELLED');
CREATE TYPE po_line_status AS ENUM ('OPEN', 'PARTIALLY_RECEIVED', 'CLOSED', 'CANCELLED');
CREATE TYPE grn_status AS ENUM ('POSTED', 'REVERSED');
CREATE TYPE issue_status AS ENUM ('DISPATCHED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');
CREATE TYPE ledger_movement_type AS ENUM ('GRN_INWARD', 'ISSUE_OUT', 'RECEIPT_IN', 'RECEIPT_SHORTAGE_WRITE_OFF', 'ADJUSTMENT', 'REVERSAL');

-- ─────────────────────────────────────────────────────────────────────────
-- AUTH: USERS
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id              BIGSERIAL PRIMARY KEY,
  name            VARCHAR(120) NOT NULL,
  email           VARCHAR(160) UNIQUE NOT NULL,
  password_hash   TEXT NOT NULL,                          -- bcrypt hash, set by app layer
  role            user_role NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at   TIMESTAMPTZ
);

-- ─────────────────────────────────────────────────────────────────────────
-- MASTER DATA
-- (warehouses defined before user_warehouses to satisfy FK dependency)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE warehouses (
  id              BIGSERIAL PRIMARY KEY,
  code            VARCHAR(20) UNIQUE NOT NULL,         -- e.g. 'CS-001', 'CC-BLR'
  name            VARCHAR(120) NOT NULL,
  city            VARCHAR(60) NOT NULL,
  bu              VARCHAR(40) NOT NULL DEFAULT 'Flipkart',
  warehouse_type  warehouse_type NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_warehouses_type ON warehouses(warehouse_type) WHERE is_active;

CREATE TABLE materials (
  id              BIGSERIAL PRIMARY KEY,
  code            VARCHAR(30) UNIQUE NOT NULL,         -- e.g. 'LDPE-06'
  name            VARCHAR(120) NOT NULL,
  category        VARCHAR(60) NOT NULL,
  unit            VARCHAR(20) NOT NULL,                -- Pcs, Roll, Bundle, Kg
  master_price    NUMERIC(12,2) NOT NULL DEFAULT 0,     -- reference price; informational only
  low_stock_qty   NUMERIC(14,3) NOT NULL DEFAULT 0,     -- default min stock (global fallback)
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE min_stock_levels (
  warehouse_id    BIGINT NOT NULL REFERENCES warehouses(id),
  material_id     BIGINT NOT NULL REFERENCES materials(id),
  min_qty         NUMERIC(14,3) NOT NULL DEFAULT 0,
  updated_by      BIGINT REFERENCES users(id),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, material_id)
);

-- ─────────────────────────────────────────────────────────────────────────
-- AUTH: USER_WAREHOUSES, SESSIONS
-- (placed after warehouses so FK references resolve)
-- ─────────────────────────────────────────────────────────────────────────

-- Which facility(s) a CC/FC exec is allowed to act on behalf of.
CREATE TABLE user_warehouses (
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  warehouse_id    BIGINT NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, warehouse_id)
);

-- Server-side session tokens (simple, stateful — easy to revoke, no JWT secret management needed).
CREATE TABLE sessions (
  token           TEXT PRIMARY KEY,                        -- random 32-byte hex, generated at login
  user_id         BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expiry ON sessions(expires_at);

-- ─────────────────────────────────────────────────────────────────────────
-- MODULE 1: INDENT UPLOAD (facility-wise, SKU-wise, for a given date)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE indent_batches (
  id                  BIGSERIAL PRIMARY KEY,
  batch_ref           VARCHAR(40) UNIQUE NOT NULL,         -- e.g. 'INDB-2026-A1B2'
  source_filename     VARCHAR(255),
  uploaded_by_user_id BIGINT REFERENCES users(id),
  indent_date         DATE NOT NULL,                       -- the date this whole batch is "for"
  status              upload_batch_status NOT NULL DEFAULT 'UPLOADED',
  total_rows          INT NOT NULL DEFAULT 0,
  valid_rows          INT NOT NULL DEFAULT 0,
  error_rows          INT NOT NULL DEFAULT 0,
  error_detail        JSONB,                                -- row-level errors, capped/sampled for large files
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_indent_batches_date ON indent_batches(indent_date);

CREATE TABLE indent_lines (
  id                  BIGSERIAL PRIMARY KEY,
  indent_ref          VARCHAR(40) UNIQUE NOT NULL,         -- e.g. 'IND-2026-004521'
  batch_id            BIGINT NOT NULL REFERENCES indent_batches(id),
  row_number_in_file  INT,
  warehouse_id        BIGINT NOT NULL REFERENCES warehouses(id),  -- the CC/FC facility
  material_id         BIGINT NOT NULL REFERENCES materials(id),
  indent_date         DATE NOT NULL,                        -- denormalized from batch for fast filtering
  requested_qty       NUMERIC(14,3) NOT NULL CHECK (requested_qty > 0),
  issued_qty          NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (issued_qty >= 0),
  status              indent_line_status NOT NULL DEFAULT 'PENDING',
  remarks             TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_issued_not_exceed_requested CHECK (issued_qty <= requested_qty)
);
CREATE INDEX idx_indent_lines_wh_status ON indent_lines(warehouse_id, status);
CREATE INDEX idx_indent_lines_material ON indent_lines(material_id);
CREATE INDEX idx_indent_lines_date ON indent_lines(indent_date);

-- ─────────────────────────────────────────────────────────────────────────
-- MODULE 2: PO UPLOAD (CSV/Excel — vendor is free text, no master validation)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE po_batches (
  id                  BIGSERIAL PRIMARY KEY,
  batch_ref           VARCHAR(40) UNIQUE NOT NULL,         -- e.g. 'POB-2026-C3D4'
  source_filename     VARCHAR(255),
  uploaded_by_user_id BIGINT REFERENCES users(id),
  status              upload_batch_status NOT NULL DEFAULT 'UPLOADED',
  total_rows          INT NOT NULL DEFAULT 0,
  valid_rows          INT NOT NULL DEFAULT 0,
  error_rows          INT NOT NULL DEFAULT 0,
  error_detail        JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE purchase_orders (
  id                    BIGSERIAL PRIMARY KEY,
  po_no                 VARCHAR(60) UNIQUE NOT NULL,        -- as typed in the sheet; uniqueness enforced here
  batch_id              BIGINT NOT NULL REFERENCES po_batches(id),
  row_number_in_file     INT,
  vendor_name            VARCHAR(160) NOT NULL,              -- free text, no FK — per requirement
  material_id            BIGINT NOT NULL REFERENCES materials(id),
  pm_store_warehouse_id  BIGINT NOT NULL REFERENCES warehouses(id),
  po_qty                 NUMERIC(14,3) NOT NULL CHECK (po_qty > 0),
  unit_price             NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  po_date                DATE NOT NULL,
  expected_delivery      DATE,
  status                 po_line_status NOT NULL DEFAULT 'OPEN',
  received_qty_cache     NUMERIC(14,3) NOT NULL DEFAULT 0,  -- kept in sync by trigger
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_po_status ON purchase_orders(status);
CREATE INDEX idx_po_material ON purchase_orders(material_id);
CREATE INDEX idx_po_warehouse ON purchase_orders(pm_store_warehouse_id);
CREATE INDEX idx_po_expected_delivery ON purchase_orders(expected_delivery);

-- ─────────────────────────────────────────────────────────────────────────
-- MODULE 3: PM STORE INWARD / GRN (against an uploaded PO)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE goods_receipts (
  id                  BIGSERIAL PRIMARY KEY,
  grn_ref             VARCHAR(40) UNIQUE NOT NULL,
  po_id               BIGINT NOT NULL REFERENCES purchase_orders(id),
  warehouse_id        BIGINT NOT NULL REFERENCES warehouses(id),
  material_id         BIGINT NOT NULL REFERENCES materials(id),
  grn_qty             NUMERIC(14,3) NOT NULL CHECK (grn_qty > 0),
  unit_price          NUMERIC(12,2) NOT NULL,
  grn_date            DATE NOT NULL,
  invoice_no          VARCHAR(80),
  invoice_date        DATE,
  received_by_user_id BIGINT REFERENCES users(id),
  status              grn_status NOT NULL DEFAULT 'POSTED',
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_grn_po ON goods_receipts(po_id);
CREATE INDEX idx_grn_warehouse_material ON goods_receipts(warehouse_id, material_id);

CREATE OR REPLACE FUNCTION fn_sync_po_received_qty() RETURNS TRIGGER AS $$
DECLARE
  v_total NUMERIC(14,3);
  v_po_qty NUMERIC(14,3);
BEGIN
  SELECT COALESCE(SUM(grn_qty),0) INTO v_total FROM goods_receipts WHERE po_id = COALESCE(NEW.po_id, OLD.po_id) AND status = 'POSTED';
  SELECT po_qty INTO v_po_qty FROM purchase_orders WHERE id = COALESCE(NEW.po_id, OLD.po_id);
  UPDATE purchase_orders
  SET received_qty_cache = v_total,
      status = CASE WHEN v_total >= v_po_qty THEN 'CLOSED' WHEN v_total > 0 THEN 'PARTIALLY_RECEIVED' ELSE 'OPEN' END,
      updated_at = now()
  WHERE id = COALESCE(NEW.po_id, OLD.po_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_grn_sync_po
AFTER INSERT OR UPDATE OR DELETE ON goods_receipts
FOR EACH ROW EXECUTE FUNCTION fn_sync_po_received_qty();

-- ─────────────────────────────────────────────────────────────────────────
-- MODULE 4: ISSUE FROM PM STORE AGAINST INDENT
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE stock_issues (
  id                    BIGSERIAL PRIMARY KEY,
  issue_ref             VARCHAR(40) UNIQUE NOT NULL,
  indent_line_id        BIGINT NOT NULL REFERENCES indent_lines(id),
  from_warehouse_id     BIGINT NOT NULL REFERENCES warehouses(id),
  to_warehouse_id       BIGINT NOT NULL REFERENCES warehouses(id),
  material_id           BIGINT NOT NULL REFERENCES materials(id),
  issued_qty            NUMERIC(14,3) NOT NULL CHECK (issued_qty > 0),
  unit_cost_snapshot    NUMERIC(12,2) NOT NULL DEFAULT 0,
  issue_date            DATE NOT NULL,
  dispatched_by_user_id BIGINT REFERENCES users(id),
  vehicle_no            VARCHAR(30),
  status                issue_status NOT NULL DEFAULT 'DISPATCHED',
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_issues_indent_line ON stock_issues(indent_line_id);
CREATE INDEX idx_issues_to_wh_status ON stock_issues(to_warehouse_id, status);

CREATE OR REPLACE FUNCTION fn_sync_indent_issued_qty() RETURNS TRIGGER AS $$
DECLARE
  v_total NUMERIC(14,3);
  v_requested NUMERIC(14,3);
BEGIN
  SELECT COALESCE(SUM(issued_qty),0) INTO v_total FROM stock_issues WHERE indent_line_id = COALESCE(NEW.indent_line_id, OLD.indent_line_id) AND status != 'CANCELLED';
  SELECT requested_qty INTO v_requested FROM indent_lines WHERE id = COALESCE(NEW.indent_line_id, OLD.indent_line_id);
  UPDATE indent_lines
  SET issued_qty = v_total,
      status = CASE WHEN v_total >= v_requested THEN 'FULLY_ISSUED' WHEN v_total > 0 THEN 'PARTIALLY_ISSUED' ELSE 'PENDING' END,
      updated_at = now()
  WHERE id = COALESCE(NEW.indent_line_id, OLD.indent_line_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_issue_sync_indent
AFTER INSERT OR UPDATE OR DELETE ON stock_issues
FOR EACH ROW EXECUTE FUNCTION fn_sync_indent_issued_qty();

-- ─────────────────────────────────────────────────────────────────────────
-- MODULE 5: RECEIVE ISSUED STOCK AT CC/FC
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE stock_receipts (
  id                   BIGSERIAL PRIMARY KEY,
  receipt_ref          VARCHAR(40) UNIQUE NOT NULL,
  stock_issue_id       BIGINT NOT NULL REFERENCES stock_issues(id),
  received_qty         NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (received_qty >= 0),
  shortage_qty         NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (shortage_qty >= 0),
  damage_qty           NUMERIC(14,3) NOT NULL DEFAULT 0 CHECK (damage_qty >= 0),
  shortage_reason      TEXT,
  received_by_user_id  BIGINT REFERENCES users(id),
  receipt_date         DATE NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_receipt_breakdown CHECK (received_qty + shortage_qty + damage_qty > 0)
);
CREATE INDEX idx_receipts_issue ON stock_receipts(stock_issue_id);

CREATE OR REPLACE FUNCTION fn_sync_issue_receipt_status() RETURNS TRIGGER AS $$
DECLARE
  v_total_accounted NUMERIC(14,3);
  v_issued NUMERIC(14,3);
BEGIN
  SELECT COALESCE(SUM(received_qty + shortage_qty + damage_qty),0) INTO v_total_accounted FROM stock_receipts WHERE stock_issue_id = NEW.stock_issue_id;
  SELECT issued_qty INTO v_issued FROM stock_issues WHERE id = NEW.stock_issue_id;
  UPDATE stock_issues
  SET status = CASE WHEN v_total_accounted >= v_issued THEN 'RECEIVED' WHEN v_total_accounted > 0 THEN 'PARTIALLY_RECEIVED' ELSE status END,
      updated_at = now()
  WHERE id = NEW.stock_issue_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_receipt_sync_issue
AFTER INSERT ON stock_receipts
FOR EACH ROW EXECUTE FUNCTION fn_sync_issue_receipt_status();

-- ─────────────────────────────────────────────────────────────────────────
-- STOCK LEDGER (single source of truth for all quantity movements)
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE stock_ledger (
  id                BIGSERIAL PRIMARY KEY,
  warehouse_id      BIGINT NOT NULL REFERENCES warehouses(id),
  material_id       BIGINT NOT NULL REFERENCES materials(id),
  movement_type     ledger_movement_type NOT NULL,
  qty_delta         NUMERIC(14,3) NOT NULL,
  unit_cost         NUMERIC(12,2) NOT NULL DEFAULT 0,
  ref_table         VARCHAR(40) NOT NULL,
  ref_id            BIGINT NOT NULL,
  movement_date     DATE NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (ref_table, ref_id, movement_type)
);
CREATE INDEX idx_ledger_wh_mat_date ON stock_ledger(warehouse_id, material_id, movement_date);
CREATE INDEX idx_ledger_ref ON stock_ledger(ref_table, ref_id);

CREATE OR REPLACE VIEW v_current_stock AS
SELECT
  warehouse_id, material_id,
  SUM(qty_delta) AS on_hand_qty,
  SUM(qty_delta * unit_cost) / NULLIF(SUM(CASE WHEN qty_delta > 0 THEN qty_delta ELSE 0 END), 0) AS weighted_avg_cost
FROM stock_ledger
GROUP BY warehouse_id, material_id;

CREATE OR REPLACE VIEW v_low_stock_alerts AS
SELECT
  w.id AS warehouse_id, w.name AS warehouse_name, w.warehouse_type,
  m.id AS material_id, m.code AS material_code, m.name AS material_name,
  COALESCE(cs.on_hand_qty, 0) AS on_hand_qty,
  COALESCE(msl.min_qty, m.low_stock_qty) AS min_qty
FROM warehouses w
CROSS JOIN materials m
LEFT JOIN v_current_stock cs ON cs.warehouse_id = w.id AND cs.material_id = m.id
LEFT JOIN min_stock_levels msl ON msl.warehouse_id = w.id AND msl.material_id = m.id
WHERE w.is_active AND m.is_active
  AND COALESCE(cs.on_hand_qty, 0) <= COALESCE(msl.min_qty, m.low_stock_qty);

-- ─────────────────────────────────────────────────────────────────────────
-- PM STORE EXEC DASHBOARD — supporting views
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW v_indent_to_process AS
SELECT
  il.warehouse_id, w.name AS warehouse_name, w.warehouse_type,
  il.material_id, m.code AS material_code, m.name AS material_name, m.unit,
  il.indent_date,
  SUM(il.requested_qty) AS total_requested,
  SUM(il.issued_qty) AS total_issued,
  SUM(il.requested_qty - il.issued_qty) AS pending_qty,
  COUNT(*) AS line_count
FROM indent_lines il
JOIN warehouses w ON w.id = il.warehouse_id
JOIN materials m ON m.id = il.material_id
WHERE il.status IN ('PENDING', 'PARTIALLY_ISSUED')
GROUP BY il.warehouse_id, w.name, w.warehouse_type, il.material_id, m.code, m.name, m.unit, il.indent_date;

CREATE OR REPLACE VIEW v_po_schedule AS
SELECT
  po.id, po.po_no, po.vendor_name, po.material_id, m.code AS material_code, m.name AS material_name,
  po.pm_store_warehouse_id, w.name AS warehouse_name,
  po.po_qty, po.received_qty_cache, (po.po_qty - po.received_qty_cache) AS remaining_qty,
  po.po_date, po.expected_delivery, po.status
FROM purchase_orders po
JOIN materials m ON m.id = po.material_id
JOIN warehouses w ON w.id = po.pm_store_warehouse_id
WHERE po.status IN ('OPEN', 'PARTIALLY_RECEIVED')
ORDER BY po.expected_delivery NULLS LAST;

-- ─────────────────────────────────────────────────────────────────────────
-- AUDIT LOG
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT REFERENCES users(id),
  action        VARCHAR(60) NOT NULL,
  entity_table  VARCHAR(60),
  entity_id     BIGINT,
  detail        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_entity ON audit_log(entity_table, entity_id);
CREATE INDEX idx_audit_created ON audit_log(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- SEED DATA (minimal, for local testing — remove/replace for real deployment)
-- ─────────────────────────────────────────────────────────────────────────

INSERT INTO warehouses (code, name, city, warehouse_type) VALUES
  ('CS-001', 'Central PM Store — Bangalore', 'Bangalore', 'PM_STORE'),
  ('CC-BLR', 'Bangalore CC', 'Bangalore', 'CC'),
  ('FC-BLR', 'Bangalore FC', 'Bangalore', 'FC');

INSERT INTO materials (code, name, category, unit, master_price, low_stock_qty) VALUES
  ('LDPE-06', 'LDPE Cover 6 Kg', 'LDPE Covers', 'Pcs', 2.50, 100),
  ('NTRLL-01', 'Net Roll', 'Rolls', 'Roll', 180, 20),
  ('WXRB-01', 'Wax Ribbon', 'Rolls', 'Roll', 250, 10);

-- Default admin login — CHANGE THIS PASSWORD immediately after first deploy.
-- Password hash below corresponds to 'ChangeMe123!' using bcrypt (generate your own via the API's hashing util).
-- INSERT INTO users (name, email, password_hash, role) VALUES
--   ('Admin', 'admin@packtrack.local', '<bcrypt-hash-here>', 'ADMIN');
