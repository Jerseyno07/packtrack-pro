-- Store the error message on failed consumption runs so it's visible in the admin UI
-- without needing to access Railway logs.
ALTER TABLE consumption_runs ADD COLUMN IF NOT EXISTS last_error TEXT NULL;
