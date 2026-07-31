-- Migration 015: add per-line remark to audit_entry_lines
-- Required when physical_qty ≠ system_qty; nullable so existing rows are unaffected.
ALTER TABLE audit_entry_lines ADD COLUMN IF NOT EXISTS remark TEXT;
