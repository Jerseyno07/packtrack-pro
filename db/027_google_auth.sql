-- Google SSO login, phase 1 (ADMIN + PM_STORE_EXEC only). Password stays
-- required for CC_EXEC/FC_EXEC/CC_DP/FC_DP (receipt-app) and the one
-- deliberately-kept admin@packtrack.local testing account.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider VARCHAR(20) NOT NULL DEFAULT 'LOCAL';
ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub VARCHAR(255) UNIQUE;
