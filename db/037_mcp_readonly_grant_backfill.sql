-- migration 024 set up `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT
-- ON TABLES TO mcp_readonly` so future tables would auto-grant to the MCP
-- hub's read-only role. It silently never took effect — pg_default_acl had
-- no entry for it at all — so every table created since then was missing
-- the grant: dice_po_push_calls, dice_po_push_pending, and sku_validation_scans.
--
-- Backfills the missing grants and re-runs the default-privilege statement.
-- Verified this time: pg_default_acl now shows a real entry for neondb_owner
-- (the role that owns/creates these tables) granting mcp_readonly SELECT, so
-- future tables should inherit it automatically. If a future table still
-- turns out to be missing the grant, don't trust "it auto-covers" again —
-- add an explicit GRANT SELECT ... TO mcp_readonly line to that table's own
-- migration instead.
GRANT SELECT ON sku_validation_scans, dice_po_push_calls, dice_po_push_pending TO mcp_readonly;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO mcp_readonly;
