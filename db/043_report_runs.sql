-- Migration 043: run-log table for the PM Store reports engine (Variance/DOI/Audit Loss).
-- Mirrors consumption_runs' idempotency pattern (run_date UNIQUE) so a given
-- report+date can't be double-sent by an overlapping cron fire or a manual
-- /run call racing the scheduler.

CREATE TABLE report_runs (
  id            BIGSERIAL PRIMARY KEY,
  report_key    VARCHAR(40) NOT NULL,
  report_date   DATE NOT NULL,
  status        VARCHAR(20) NOT NULL DEFAULT 'RUNNING', -- RUNNING, SUCCESS, FAILED
  dry_run       BOOLEAN NOT NULL DEFAULT FALSE,
  duration_ms   INT,
  error         TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ,
  UNIQUE (report_key, report_date, dry_run)
);
CREATE INDEX idx_report_runs_key_date ON report_runs(report_key, report_date);
