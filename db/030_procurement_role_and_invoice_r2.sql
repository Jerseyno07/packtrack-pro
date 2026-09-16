-- New role for the procurement team's /proc view (PO status + DICE flagged
-- items retry). Google SSO, same phase-1 pattern as ADMIN/PM_STORE_EXEC.
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'PROCUREMENT';
