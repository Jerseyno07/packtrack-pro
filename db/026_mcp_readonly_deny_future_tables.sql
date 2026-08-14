-- 024_mcp_readonly_role.sql's ALTER DEFAULT PRIVILEGES auto-grants SELECT on
-- every NEW table the owner role creates to mcp_readonly. 025 patched the three
-- tables that existed at the time (ninjacart-mcp-hub's own oauth_clients,
-- refresh_tokens, knowledge_chunks), but that was a one-time fix, not a policy
-- change: any table created after 025 is exposed again by default, silently.
--
-- Flip the default from grant-all to deny-by-default. Tables already granted
-- (PackTrack Pro's own business tables) keep their existing SELECT grant --
-- this only changes what happens for tables created from this point forward.
-- New PackTrack Pro tables that should be queryable via query_packtrack_db
-- now need an explicit follow-up GRANT SELECT, same as any other deliberate
-- access decision.

ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM mcp_readonly;
