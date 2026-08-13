-- Read-only Postgres role for the ninjacart-mcp-hub MCP server.
-- SELECT on every table EXCEPT users and sessions (credentials/session tokens).
-- ALTER DEFAULT PRIVILEGES auto-covers future new tables.
--
-- Password is generated separately and set via Neon console / ALTER ROLE, not
-- committed here in plaintext. See ~/Documents/ninjacart-mcp-hub/Ninjacart MCP Hub/04 - PackTrack Integration.md
-- for the resulting connection string handling.

CREATE ROLE mcp_readonly WITH LOGIN;

GRANT CONNECT ON DATABASE neondb TO mcp_readonly;
GRANT USAGE ON SCHEMA public TO mcp_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO mcp_readonly;

-- Explicitly strip the two sensitive tables.
REVOKE SELECT ON users, sessions FROM mcp_readonly;

-- Future tables auto-readable, no follow-up grant migration needed.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO mcp_readonly;

-- DB-side enforcement of the statement timeout (defense in depth alongside queryGuard.js).
ALTER ROLE mcp_readonly SET statement_timeout = '10s';
