-- Migration 014: add progress tracking columns to consumption_runs
ALTER TABLE consumption_runs ADD COLUMN IF NOT EXISTS progress_pct INT DEFAULT 0;
ALTER TABLE consumption_runs ADD COLUMN IF NOT EXISTS progress_msg TEXT;
