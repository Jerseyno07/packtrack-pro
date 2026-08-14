-- Fixes an unintended grant: 024_mcp_readonly_role.sql's
-- ALTER DEFAULT PRIVILEGES ... GRANT SELECT ON TABLES TO mcp_readonly
-- auto-granted SELECT on every future table created by the owner role,
-- including ninjacart-mcp-hub's own operational tables (knowledge_chunks,
-- oauth_clients, refresh_tokens) - none of which are PackTrack Pro business
-- data, and refresh_tokens specifically holds OAuth session metadata that
-- the general-purpose query_packtrack_db tool should never be able to read.
--
-- mcp_readonly should only ever see PackTrack Pro's own tables.

REVOKE SELECT ON knowledge_chunks, oauth_clients, refresh_tokens FROM mcp_readonly;
