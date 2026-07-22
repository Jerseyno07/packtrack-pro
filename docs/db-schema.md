# Database Schema — PackTrack Pro

Source of truth for all tables, columns, types, keys, constraints, and relationships.
Pulled directly from Neon PostgreSQL on 2026-07-22.

---

## Table Index

| Table | Purpose |
|---|---|
| `users` | Login accounts and roles |
| `sessions` | JWT session tokens |
| `warehouses` | PM Store, FC, and CC facilities |
| `user_warehouses` | Maps users to their facility (many-to-many) |
| `materials` | Packaging material master |
| `po_batches` | Upload batch header for PO CSV uploads |
| `purchase_orders` | Vendor PO lines (one row per material per PO number) |
| `goods_receipts` | Inward GRN records against a PO line |
| `indent_batches` | Upload batch header for indent CSV uploads |
| `indent_lines` | FC/CC material requests (one line per material) |
| `stock_issues` | PM Store dispatches to FC/CC against an indent line |
| `stock_receipts` | FC/CC acknowledgement of a received dispatch |
| `stock_ledger` | Append-only ledger of every stock movement |
| `min_stock_levels` | Per-facility low-stock thresholds |
| `sku_packaging_master` | FSN → primary/secondary/tertiary PM mapping |
| `consumption_runs` | Daily scraper execution log |
| `consumption_run_lines` | Per-SKU-per-facility deduction detail |
| `audit_entries` | Physical stock count audit header |
| `audit_entry_lines` | Per-material count result (system vs physical) |
| `audit_log` | System-wide action trail (all API mutations) |
| `admin_reversals` | Admin cancel/reverse-force-complete records |

**Views** (read-only, derived): `v_current_stock`, `v_po_schedule`, `v_indent_to_process`, `v_low_stock_alerts`

---

## Enum Types

### `user_role`
`ADMIN` · `PM_STORE_EXEC` · `CC_EXEC` · `FC_EXEC` · `CC_DP` · `FC_DP`

### `warehouse_type`
`PM_STORE` · `CC` · `FC`

### `po_line_status`
`OPEN` → `PARTIALLY_RECEIVED` → `CLOSED` | `CANCELLED` | `FORCE_COMPLETED`

### `grn_status`
`POSTED` · `REVERSED`

### `indent_line_status`
`PENDING` → `PARTIALLY_ISSUED` → `FULLY_ISSUED` | `CANCELLED` | `FORCE_COMPLETED`

### `issue_status`
`DISPATCHED` → `PARTIALLY_RECEIVED` → `RECEIVED` | `CANCELLED` | `FORCE_COMPLETED`

### `ledger_movement_type`
`GRN_INWARD` · `ISSUE_OUT` · `RECEIPT_IN` · `RECEIPT_SHORTAGE_WRITE_OFF` · `ADJUSTMENT` · `REVERSAL` · `CONSUMPTION` · `AUDIT_ADJUSTMENT`

### `upload_batch_status`
`UPLOADED` · `VALIDATED` · `PARTIALLY_FAILED` · `FAILED`

---

## Tables

---

### `users`
Login accounts for all roles.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` 🔑 | `bigint` | NOT NULL | auto-increment | PK |
| `name` | `varchar(120)` | NOT NULL | | Display name |
| `email` | `varchar(160)` | NOT NULL | | Login identifier — **UNIQUE** |
| `password_hash` | `text` | NOT NULL | | bcrypt 10 rounds |
| `role` | `user_role` | NOT NULL | | Enum (see above) |
| `is_active` | `boolean` | NOT NULL | `true` | Soft-disable |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `last_login_at` | `timestamptz` | NULL | | Set on successful login |

**Unique:** `email`
**Referenced by:** `sessions`, `user_warehouses`, `goods_receipts`, `indent_batches`, `indent_lines`, `po_batches`, `purchase_orders`, `sku_packaging_master`, `stock_issues`, `stock_receipts`, `audit_entries`, `audit_log`, `admin_reversals`, `min_stock_levels`

---

### `sessions`
JWT session tokens (stateless validation fallback).

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `token` 🔑 | `text` | NOT NULL | | PK — the JWT string |
| `user_id` | `bigint` | NOT NULL | | FK → `users.id` |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `expires_at` | `timestamptz` | NOT NULL | | Used for expiry checks |

**Foreign keys:** `user_id` → `users.id`
**Indexes:** `idx_sessions_user` (user_id), `idx_sessions_expiry` (expires_at)

---

### `warehouses`
All physical locations — PM Store, FC, and CC facilities.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` 🔑 | `bigint` | NOT NULL | auto-increment | PK |
| `code` | `varchar(20)` | NOT NULL | | Business identifier — **UNIQUE** (e.g. `CS-001`, `FC-BLR-9382`) |
| `name` | `varchar(120)` | NOT NULL | | Display name |
| `city` | `varchar(60)` | NOT NULL | | |
| `bu` | `varchar(40)` | NOT NULL | `'Flipkart'` | Business unit |
| `warehouse_type` | `warehouse_type` | NOT NULL | | `PM_STORE` / `CC` / `FC` |
| `is_active` | `boolean` | NOT NULL | `true` | |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

**Unique:** `code`
**Indexes:** `idx_warehouses_type` (warehouse_type WHERE is_active)
**Referenced by:** `user_warehouses`, `purchase_orders`, `goods_receipts`, `indent_lines`, `stock_issues` (×2), `stock_ledger`, `min_stock_levels`, `audit_entries`, `consumption_run_lines`

---

### `user_warehouses`
Maps each user to the warehouse(s) they operate. Composite PK — no surrogate key.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `user_id` 🔑 | `bigint` | NOT NULL | FK → `users.id` |
| `warehouse_id` 🔑 | `bigint` | NOT NULL | FK → `warehouses.id` |

**Foreign keys:** `user_id` → `users.id` · `warehouse_id` → `warehouses.id`

---

### `materials`
Packaging material master — 28 active SKUs.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` 🔑 | `bigint` | NOT NULL | auto-increment | PK |
| `code` | `varchar(30)` | NOT NULL | | Business code — **UNIQUE** (e.g. `LDPE-06`, `NTRLL-01`) |
| `name` | `varchar(120)` | NOT NULL | | |
| `category` | `varchar(60)` | NOT NULL | | |
| `unit` | `varchar(20)` | NOT NULL | | `Pcs`, `Kg`, `Roll`, `Bag`, etc. |
| `master_price` | `numeric` | NOT NULL | `0` | Default unit price |
| `low_stock_qty` | `numeric` | NOT NULL | `0` | Legacy threshold (superseded by `min_stock_levels`) |
| `is_active` | `boolean` | NOT NULL | `true` | |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `meters_per_unit` | `numeric` | NULL | | Roll materials only — stock held in meters. E.g. 0.5 m deducted per unit packed |

**Unique:** `code`
**Referenced by:** `purchase_orders`, `goods_receipts`, `indent_lines`, `stock_issues`, `stock_ledger`, `min_stock_levels`, `audit_entry_lines`, `sku_packaging_master` (×3)

---

### `po_batches`
Header record created each time a PO CSV is uploaded.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` 🔑 | `bigint` | NOT NULL | auto-increment | PK |
| `batch_ref` | `varchar(40)` | NOT NULL | | **UNIQUE** — auto-generated reference |
| `source_filename` | `varchar(255)` | NULL | | Original uploaded filename |
| `uploaded_by_user_id` | `bigint` | NULL | | FK → `users.id` |
| `status` | `upload_batch_status` | NOT NULL | `'UPLOADED'` | |
| `total_rows` | `integer` | NOT NULL | `0` | Rows parsed from file |
| `valid_rows` | `integer` | NOT NULL | `0` | Rows inserted |
| `error_rows` | `integer` | NOT NULL | `0` | Rows rejected |
| `error_detail` | `jsonb` | NULL | | Per-row error messages |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

**Foreign keys:** `uploaded_by_user_id` → `users.id`
**Unique:** `batch_ref`

---

### `purchase_orders`
One row per material per PO number. A single `po_no` can cover multiple materials.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` 🔑 | `bigint` | NOT NULL | auto-increment | PK |
| `po_no` | `varchar(60)` | NOT NULL | | PO number from vendor — **UNIQUE together with `material_id`** |
| `batch_id` | `bigint` | NOT NULL | | FK → `po_batches.id` |
| `row_number_in_file` | `integer` | NULL | | Source row for error tracing |
| `vendor_name` | `varchar(160)` | NOT NULL | | Free text |
| `material_id` | `bigint` | NOT NULL | | FK → `materials.id` |
| `pm_store_warehouse_id` | `bigint` | NOT NULL | | FK → `warehouses.id` — destination PM Store |
| `po_qty` | `numeric` | NOT NULL | | Total ordered quantity |
| `unit_price` | `numeric` | NOT NULL | | At time of order |
| `po_date` | `date` | NOT NULL | | |
| `expected_delivery` | `date` | NULL | | |
| `status` | `po_line_status` | NOT NULL | `'OPEN'` | See enum above |
| `received_qty_cache` | `numeric` | NOT NULL | `0` | Running total of all GRN qty; updated by trigger |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | |
| `force_completed_by` | `bigint` | NULL | | FK → `users.id` |
| `force_completed_at` | `timestamptz` | NULL | | |
| `force_complete_reason` | `text` | NULL | | |

**Foreign keys:** `batch_id` → `po_batches.id` · `material_id` → `materials.id` · `pm_store_warehouse_id` → `warehouses.id` · `force_completed_by` → `users.id`
**Unique:** `(po_no, material_id)`
**Indexes:** `idx_po_po_no`, `idx_po_status`, `idx_po_material`, `idx_po_warehouse`, `idx_po_expected_delivery`

---

### `goods_receipts`
Each inward delivery (GRN) posted against a PO line.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` 🔑 | `bigint` | NOT NULL | auto-increment | PK |
| `grn_ref` | `varchar(40)` | NOT NULL | | **UNIQUE** — auto-generated (e.g. `GRN-20260722-001`) |
| `po_id` | `bigint` | NOT NULL | | FK → `purchase_orders.id` |
| `warehouse_id` | `bigint` | NOT NULL | | FK → `warehouses.id` — PM Store receiving |
| `material_id` | `bigint` | NOT NULL | | FK → `materials.id` (denormalised from PO for fast queries) |
| `grn_qty` | `numeric` | NOT NULL | | Quantity received in this delivery |
| `unit_price` | `numeric` | NOT NULL | | Price at time of receipt |
| `grn_date` | `date` | NOT NULL | | |
| `invoice_no` | `varchar(80)` | NULL | | Vendor invoice number |
| `invoice_date` | `date` | NULL | | |
| `received_by_user_id` | `bigint` | NULL | | FK → `users.id` |
| `status` | `grn_status` | NOT NULL | `'POSTED'` | `POSTED` or `REVERSED` |
| `notes` | `text` | NULL | | |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `invoice_image_path` | `text` | NULL | | S3 / storage path of uploaded invoice scan |

**Foreign keys:** `po_id` → `purchase_orders.id` · `warehouse_id` → `warehouses.id` · `material_id` → `materials.id` · `received_by_user_id` → `users.id`
**Unique:** `grn_ref`
**Indexes:** `idx_grn_po`, `idx_grn_warehouse_material`

---

### `indent_batches`
Header record created each time an indent CSV is uploaded by an FC/CC exec.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` 🔑 | `bigint` | NOT NULL | auto-increment | PK |
| `batch_ref` | `varchar(40)` | NOT NULL | | **UNIQUE** |
| `source_filename` | `varchar(255)` | NULL | | |
| `uploaded_by_user_id` | `bigint` | NULL | | FK → `users.id` |
| `indent_date` | `date` | NOT NULL | | Date of the indent |
| `status` | `upload_batch_status` | NOT NULL | `'UPLOADED'` | |
| `total_rows` | `integer` | NOT NULL | `0` | |
| `valid_rows` | `integer` | NOT NULL | `0` | |
| `error_rows` | `integer` | NOT NULL | `0` | |
| `error_detail` | `jsonb` | NULL | | |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

**Foreign keys:** `uploaded_by_user_id` → `users.id`
**Unique:** `batch_ref`
**Indexes:** `idx_indent_batches_date`

---

### `indent_lines`
One line per material per indent batch. This is the unit of fulfilment.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` 🔑 | `bigint` | NOT NULL | auto-increment | PK |
| `indent_ref` | `varchar(40)` | NOT NULL | | **UNIQUE** — auto-generated reference |
| `batch_id` | `bigint` | NOT NULL | | FK → `indent_batches.id` |
| `row_number_in_file` | `integer` | NULL | | |
| `warehouse_id` | `bigint` | NOT NULL | | FK → `warehouses.id` — requesting FC/CC |
| `material_id` | `bigint` | NOT NULL | | FK → `materials.id` |
| `indent_date` | `date` | NOT NULL | | |
| `requested_qty` | `numeric` | NOT NULL | | Quantity requested |
| `issued_qty` | `numeric` | NOT NULL | `0` | Running total dispatched; updated by trigger |
| `status` | `indent_line_status` | NOT NULL | `'PENDING'` | See enum above |
| `remarks` | `text` | NULL | | |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | |
| `force_completed_by` | `bigint` | NULL | | FK → `users.id` |
| `force_completed_at` | `timestamptz` | NULL | | |
| `force_complete_reason` | `text` | NULL | | |

**Foreign keys:** `batch_id` → `indent_batches.id` · `warehouse_id` → `warehouses.id` · `material_id` → `materials.id` · `force_completed_by` → `users.id`
**Unique:** `indent_ref`
**Indexes:** `idx_indent_lines_wh_status`, `idx_indent_lines_material`, `idx_indent_lines_date`

---

### `stock_issues`
A dispatch from PM Store to an FC/CC facility, always tied to an indent line.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` 🔑 | `bigint` | NOT NULL | auto-increment | PK |
| `issue_ref` | `varchar(40)` | NOT NULL | | **UNIQUE** — auto-generated reference |
| `indent_line_id` | `bigint` | NOT NULL | | FK → `indent_lines.id` |
| `from_warehouse_id` | `bigint` | NOT NULL | | FK → `warehouses.id` — PM Store |
| `to_warehouse_id` | `bigint` | NOT NULL | | FK → `warehouses.id` — destination FC/CC |
| `material_id` | `bigint` | NOT NULL | | FK → `materials.id` |
| `issued_qty` | `numeric` | NOT NULL | | Quantity dispatched |
| `unit_cost_snapshot` | `numeric` | NOT NULL | `0` | WACC at time of dispatch |
| `issue_date` | `date` | NOT NULL | | |
| `dispatched_by_user_id` | `bigint` | NULL | | FK → `users.id` |
| `vehicle_no` | `varchar(30)` | NULL | | Transport vehicle |
| `status` | `issue_status` | NOT NULL | `'DISPATCHED'` | See enum above |
| `notes` | `text` | NULL | | |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | |
| `force_completed_by` | `bigint` | NULL | | FK → `users.id` |
| `force_completed_at` | `timestamptz` | NULL | | |
| `force_complete_reason` | `text` | NULL | | |
| `expected_qty` | `numeric` | NULL | | Qty expected at destination (from indent) |

**Foreign keys:** `indent_line_id` → `indent_lines.id` · `from_warehouse_id` → `warehouses.id` · `to_warehouse_id` → `warehouses.id` · `material_id` → `materials.id` · `dispatched_by_user_id` → `users.id` · `force_completed_by` → `users.id`
**Unique:** `issue_ref`
**Indexes:** `idx_issues_to_wh_status`, `idx_issues_indent_line`

---

### `stock_receipts`
FC/CC acknowledgement that a dispatched shipment has been received.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` 🔑 | `bigint` | NOT NULL | auto-increment | PK |
| `receipt_ref` | `varchar(40)` | NOT NULL | | **UNIQUE** — auto-generated reference |
| `stock_issue_id` | `bigint` | NOT NULL | | FK → `stock_issues.id` |
| `received_qty` | `numeric` | NOT NULL | `0` | Actual quantity received |
| `shortage_qty` | `numeric` | NOT NULL | `0` | Dispatched − received |
| `damage_qty` | `numeric` | NOT NULL | `0` | Damaged on arrival |
| `shortage_reason` | `text` | NULL | | |
| `received_by_user_id` | `bigint` | NULL | | FK → `users.id` |
| `receipt_date` | `date` | NOT NULL | | |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |
| `expected_qty` | `numeric` | NULL | | Snapshotted from issue at receipt time |

**Foreign keys:** `stock_issue_id` → `stock_issues.id` · `received_by_user_id` → `users.id`
**Unique:** `receipt_ref`
**Indexes:** `idx_receipts_issue`

---

### `stock_ledger`
**Append-only.** Every stock movement writes one row here. Current stock is derived by summing `qty_delta` grouped by `(warehouse_id, material_id)`. Never updated or deleted.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` 🔑 | `bigint` | NOT NULL | auto-increment | PK |
| `warehouse_id` | `bigint` | NOT NULL | | FK → `warehouses.id` |
| `material_id` | `bigint` | NOT NULL | | FK → `materials.id` |
| `movement_type` | `ledger_movement_type` | NOT NULL | | See enum above |
| `qty_delta` | `numeric` | NOT NULL | | Positive = stock in, negative = stock out |
| `unit_cost` | `numeric` | NOT NULL | `0` | For WACC calculation |
| `ref_table` | `varchar(40)` | NOT NULL | | Source table name (e.g. `goods_receipts`) |
| `ref_id` | `bigint` | NOT NULL | | PK of the source record |
| `movement_date` | `date` | NOT NULL | | |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

**Foreign keys:** `warehouse_id` → `warehouses.id` · `material_id` → `materials.id`
**Unique:** `(ref_table, ref_id, movement_type)` — prevents duplicate ledger entries for the same event
**Indexes:** `idx_ledger_wh_mat_date`, `idx_ledger_ref`

---

### `min_stock_levels`
Per-facility, per-material low-stock threshold. Composite PK — no surrogate key.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `warehouse_id` 🔑 | `bigint` | NOT NULL | | FK → `warehouses.id` |
| `material_id` 🔑 | `bigint` | NOT NULL | | FK → `materials.id` |
| `min_qty` | `numeric` | NOT NULL | `0` | Alert fires when on-hand falls below this |
| `updated_by` | `bigint` | NULL | | FK → `users.id` |
| `updated_at` | `timestamptz` | NOT NULL | `now()` | |

**Foreign keys:** `warehouse_id` → `warehouses.id` · `material_id` → `materials.id` · `updated_by` → `users.id`

---

### `sku_packaging_master`
Maps each FSN (Ninjacart product SKU) to up to three packaging materials. Used by the consumption scraper to determine which PM stock to deduct.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` 🔑 | `bigint` | NOT NULL | auto-increment | PK |
| `sku_code` | `varchar(60)` | NOT NULL | | Ninjacart FSN — **UNIQUE** |
| `sku_name` | `varchar(160)` | NULL | | |
| `primary_pm_code` | `varchar(30)` | NULL | | FK → `materials.code` |
| `secondary_pm_code` | `varchar(30)` | NULL | | FK → `materials.code` |
| `tertiary_pm_code` | `varchar(30)` | NULL | | FK → `materials.code` |
| `uploaded_by` | `bigint` | NULL | | FK → `users.id` |
| `uploaded_at` | `timestamptz` | NOT NULL | `now()` | |

**Foreign keys:** `primary_pm_code` → `materials.code` · `secondary_pm_code` → `materials.code` · `tertiary_pm_code` → `materials.code` · `uploaded_by` → `users.id`
**Unique:** `sku_code`

---

### `consumption_runs`
One row per daily scraper execution. Unique on `run_date`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` 🔑 | `bigint` | NOT NULL | auto-increment | PK |
| `run_date` | `date` | NOT NULL | | **UNIQUE** — prevents duplicate runs |
| `scraped_from` | `date` | NOT NULL | | Date range pulled from Redash |
| `scraped_to` | `date` | NOT NULL | | |
| `status` | `varchar(20)` | NOT NULL | `'RUNNING'` | `RUNNING` / `COMPLETED` / `FAILED` |
| `total_sku_facility_rows` | `integer` | NOT NULL | `0` | Total rows from Redash |
| `deducted_lines` | `integer` | NOT NULL | `0` | Lines that wrote to stock_ledger |
| `skipped_lines` | `integer` | NOT NULL | `0` | Unmapped FSNs etc. |
| `error_lines` | `integer` | NOT NULL | `0` | |
| `started_at` | `timestamptz` | NOT NULL | `now()` | |
| `completed_at` | `timestamptz` | NULL | | Null while still running |

**Unique:** `run_date`

---

### `consumption_run_lines`
Per-SKU-per-facility detail for a consumption run.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` 🔑 | `bigint` | NOT NULL | auto-increment | PK |
| `run_id` | `bigint` | NOT NULL | | FK → `consumption_runs.id` |
| `facility_id` | `varchar(30)` | NOT NULL | | Redash facility ID (may not match a warehouse) |
| `warehouse_id` | `bigint` | NULL | | FK → `warehouses.id` — null if facility unmapped |
| `sku_code` | `varchar(60)` | NOT NULL | | Ninjacart FSN |
| `packaging_tier` | `varchar(10)` | NOT NULL | | `primary` / `secondary` / `tertiary` |
| `material_code` | `varchar(30)` | NULL | | Resolved material code |
| `packaged_qty` | `numeric` | NOT NULL | | Units packed at FC/CC |
| `qty_deducted` | `numeric` | NOT NULL | `0` | Actual deduction in stock units (meters for rolls) |
| `status` | `varchar(30)` | NOT NULL | | `DEDUCTED` / `SKIPPED` / `UNMAPPED_SKU` / `UNMAPPED_FACILITY` / `ERROR` |
| `error_detail` | `text` | NULL | | |
| `ledger_id` | `bigint` | NULL | | FK → `stock_ledger.id` — null if not deducted |

**Foreign keys:** `run_id` → `consumption_runs.id` · `warehouse_id` → `warehouses.id` · `ledger_id` → `stock_ledger.id`
**Indexes:** `idx_crl_run`

---

### `audit_entries`
Header for a physical stock count at a facility.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` 🔑 | `bigint` | NOT NULL | auto-increment | PK |
| `audit_ref` | `varchar(40)` | NOT NULL | | **UNIQUE** — auto-generated reference |
| `warehouse_id` | `bigint` | NOT NULL | | FK → `warehouses.id` |
| `conducted_by` | `bigint` | NOT NULL | | FK → `users.id` |
| `remarks` | `text` | NOT NULL | | |
| `audit_date` | `date` | NOT NULL | `CURRENT_DATE` | |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

**Foreign keys:** `warehouse_id` → `warehouses.id` · `conducted_by` → `users.id`
**Unique:** `audit_ref`

---

### `audit_entry_lines`
Per-material result of a physical count — compares system qty vs physical count and writes an adjustment to `stock_ledger`.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` 🔑 | `bigint` | NOT NULL | auto-increment | PK |
| `audit_entry_id` | `bigint` | NOT NULL | | FK → `audit_entries.id` |
| `material_id` | `bigint` | NOT NULL | | FK → `materials.id` |
| `system_qty` | `numeric` | NOT NULL | | Stock ledger qty at time of audit |
| `physical_qty` | `numeric` | NOT NULL | | Count recorded on the floor |
| `delta` | `numeric` | NULL | | `physical_qty − system_qty`; written by trigger |
| `ledger_id` | `bigint` | NULL | | FK → `stock_ledger.id` — the adjustment entry |

**Foreign keys:** `audit_entry_id` → `audit_entries.id` · `material_id` → `materials.id` · `ledger_id` → `stock_ledger.id`
**Indexes:** `idx_ael_entry`

---

### `audit_log`
System-wide action trail. Every API mutation writes one row here.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` 🔑 | `bigint` | NOT NULL | auto-increment | PK |
| `user_id` | `bigint` | NULL | | FK → `users.id` — null for system actions |
| `action` | `varchar(60)` | NOT NULL | | e.g. `GRN_POSTED`, `ADMIN_PASSWORD_RESET`, `FORCE_COMPLETE` |
| `entity_table` | `varchar(60)` | NULL | | Table the action touched |
| `entity_id` | `bigint` | NULL | | PK of the affected record |
| `detail` | `jsonb` | NULL | | Additional context (varies by action) |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

**Foreign keys:** `user_id` → `users.id`
**Indexes:** `idx_audit_entity` (entity_table, entity_id), `idx_audit_created` (created_at DESC)

---

### `admin_reversals`
Records every admin cancel or reverse-force-complete action, including a snapshot of the previous state.

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` 🔑 | `bigint` | NOT NULL | auto-increment | PK |
| `admin_user_id` | `bigint` | NOT NULL | | FK → `users.id` |
| `entity_table` | `varchar(40)` | NOT NULL | | `purchase_orders` or `stock_issues` |
| `entity_id` | `bigint` | NOT NULL | | PK of the cancelled/reversed record |
| `action` | `varchar(50)` | NOT NULL | | `CANCEL` or `REVERSE_FORCE_COMPLETE` |
| `reason` | `text` | NOT NULL | | Written by admin |
| `previous_state` | `jsonb` | NOT NULL | | Snapshot of the record before the action |
| `created_at` | `timestamptz` | NOT NULL | `now()` | |

**Foreign keys:** `admin_user_id` → `users.id`
**Indexes:** `idx_admin_reversals_entity` (entity_table, entity_id)

---

## Views

| View | Derived from | Purpose |
|---|---|---|
| `v_current_stock` | `stock_ledger` (SUM of qty_delta) | Live on-hand qty + weighted avg cost per warehouse × material |
| `v_po_schedule` | `purchase_orders` + `materials` + `warehouses` | PO list with remaining_qty = po_qty − received_qty_cache |
| `v_indent_to_process` | `indent_lines` + `warehouses` + `materials` | Pending indent summary grouped by warehouse × material |
| `v_low_stock_alerts` | `v_current_stock` + `min_stock_levels` | Warehouse × material rows where on_hand_qty < min_qty |

---

## Entity Relationships

```
users ──────────────────────────────────────────────────────────────┐
  │                                                                  │
  ├── user_warehouses ── warehouses ─────────────────────────────┐  │
  │                          │                                   │  │
  │                          ├── purchase_orders ◄── po_batches  │  │
  │                          │       │                           │  │
  │                          │       └── goods_receipts          │  │
  │                          │               │                   │  │
  │                          ├── indent_lines ◄── indent_batches │  │
  │                          │       │                           │  │
  │                          │       └── stock_issues ──────────┤  │
  │                          │               │                   │  │
  │                          │               └── stock_receipts  │  │
  │                          │                                   │  │
  │                          └── min_stock_levels                │  │
  │                                                              │  │
  ├─────────────────── stock_ledger ◄────────────────────────────┘  │
  │                       (append-only;                              │
  │                     referenced by audit_entry_lines,             │
  │                     consumption_run_lines)                       │
  │                                                                  │
  ├── audit_entries ── audit_entry_lines ── stock_ledger            │
  │                                                                  │
  ├── audit_log                                                      │
  │                                                                  │
  ├── admin_reversals                                                │
  │                                                                  │
  ├── consumption_runs ── consumption_run_lines ── stock_ledger      │
  │                                                                  │
  ├── sku_packaging_master ── materials (×3 via code)                │
  │                                                                  │
  └── sessions ─────────────────────────────────────────────────────┘

materials ─── purchase_orders, goods_receipts, indent_lines,
              stock_issues, stock_ledger, min_stock_levels,
              audit_entry_lines, sku_packaging_master (×3)
```

**Flow summary:**
1. Admin uploads PO CSV → `po_batches` + `purchase_orders`
2. PM Store exec posts GRN → `goods_receipts` → trigger updates `purchase_orders.received_qty_cache` + writes to `stock_ledger` (GRN_INWARD)
3. FC/CC exec uploads indent → `indent_batches` + `indent_lines`
4. PM Store exec dispatches → `stock_issues` → trigger updates `indent_lines.issued_qty` + writes to `stock_ledger` (ISSUE_OUT)
5. FC/CC exec acknowledges → `stock_receipts` → trigger writes to `stock_ledger` (RECEIPT_IN, and RECEIPT_SHORTAGE_WRITE_OFF if short)
6. Consumption scraper runs daily → `consumption_runs` + `consumption_run_lines` → writes to `stock_ledger` (CONSUMPTION)
7. Physical audit → `audit_entries` + `audit_entry_lines` → writes to `stock_ledger` (AUDIT_ADJUSTMENT)
