-- Migration 008: per-facility consumption runs
-- Adds facility_filter to consumption_runs and replaces the single run_date
-- unique constraint with two partial indexes so multiple facility-specific
-- runs can coexist on the same calendar day.

ALTER TABLE consumption_runs ADD COLUMN IF NOT EXISTS facility_filter TEXT NULL;

-- Drop the old single-column unique constraint
ALTER TABLE consumption_runs DROP CONSTRAINT IF EXISTS consumption_runs_run_date_key;

-- All-facilities runs: still max one per day (facility_filter IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS consumption_runs_date_all_key
  ON consumption_runs (run_date)
  WHERE facility_filter IS NULL;

-- Facility-specific runs: max one per warehouse per day
CREATE UNIQUE INDEX IF NOT EXISTS consumption_runs_date_facility_key
  ON consumption_runs (run_date, facility_filter)
  WHERE facility_filter IS NOT NULL;
