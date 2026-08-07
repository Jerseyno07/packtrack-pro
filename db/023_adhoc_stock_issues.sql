-- Allow adhoc stock issues without a backing indent line
ALTER TABLE stock_issues ALTER COLUMN indent_line_id DROP NOT NULL;
