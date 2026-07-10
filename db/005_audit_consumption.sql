-- Migration 005: Audit & Consumption tracking
-- Adds CONSUMPTION and AUDIT_ADJUSTMENT ledger movement types,
-- SKU packaging master, consumption run tables, and audit tables.

ALTER TYPE ledger_movement_type ADD VALUE IF NOT EXISTS 'CONSUMPTION';
ALTER TYPE ledger_movement_type ADD VALUE IF NOT EXISTS 'AUDIT_ADJUSTMENT';

CREATE TABLE sku_packaging_master (
  id               BIGSERIAL PRIMARY KEY,
  sku_code         VARCHAR(60)  UNIQUE NOT NULL,
  sku_name         VARCHAR(160),
  primary_pm_code  VARCHAR(30)  REFERENCES materials(code),
  secondary_pm_code VARCHAR(30) REFERENCES materials(code),
  tertiary_pm_code  VARCHAR(30) REFERENCES materials(code),
  uploaded_by      BIGINT REFERENCES users(id),
  uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE consumption_runs (
  id                    BIGSERIAL PRIMARY KEY,
  run_date              DATE NOT NULL UNIQUE,
  scraped_from          DATE NOT NULL,
  scraped_to            DATE NOT NULL,
  status                VARCHAR(20) NOT NULL DEFAULT 'RUNNING',
  total_sku_facility_rows INT NOT NULL DEFAULT 0,
  deducted_lines        INT NOT NULL DEFAULT 0,
  skipped_lines         INT NOT NULL DEFAULT 0,
  error_lines           INT NOT NULL DEFAULT 0,
  started_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ
);

CREATE TABLE consumption_run_lines (
  id             BIGSERIAL PRIMARY KEY,
  run_id         BIGINT NOT NULL REFERENCES consumption_runs(id),
  facility_id    VARCHAR(30) NOT NULL,
  warehouse_id   BIGINT REFERENCES warehouses(id),
  sku_code       VARCHAR(60) NOT NULL,
  packaging_tier VARCHAR(10) NOT NULL,
  material_code  VARCHAR(30),
  packaged_qty   NUMERIC(14,3) NOT NULL,
  qty_deducted   NUMERIC(14,3) NOT NULL DEFAULT 0,
  status         VARCHAR(30) NOT NULL,
  error_detail   TEXT,
  ledger_id      BIGINT REFERENCES stock_ledger(id)
);
CREATE INDEX idx_crl_run ON consumption_run_lines(run_id);

CREATE TABLE audit_entries (
  id           BIGSERIAL PRIMARY KEY,
  audit_ref    VARCHAR(40) UNIQUE NOT NULL,
  warehouse_id BIGINT NOT NULL REFERENCES warehouses(id),
  conducted_by BIGINT NOT NULL REFERENCES users(id),
  remarks      TEXT NOT NULL,
  audit_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_entry_lines (
  id             BIGSERIAL PRIMARY KEY,
  audit_entry_id BIGINT NOT NULL REFERENCES audit_entries(id),
  material_id    BIGINT NOT NULL REFERENCES materials(id),
  system_qty     NUMERIC(14,3) NOT NULL,
  physical_qty   NUMERIC(14,3) NOT NULL,
  delta          NUMERIC(14,3) GENERATED ALWAYS AS (physical_qty - system_qty) STORED,
  ledger_id      BIGINT REFERENCES stock_ledger(id)
);
CREATE INDEX idx_ael_entry ON audit_entry_lines(audit_entry_id);
