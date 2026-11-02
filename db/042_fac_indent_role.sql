-- New role for facility users who should only be able to upload indents
-- (no receipt, transfer, audit, or stock-issue access) — password-based,
-- same phase as CC_EXEC/FC_EXEC/CC_DP/FC_DP.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'FAC_INDENT';
