-- Store R2 object key for original uploaded file on each batch
ALTER TABLE indent_batches ADD COLUMN IF NOT EXISTS source_file_key VARCHAR;
ALTER TABLE po_batches     ADD COLUMN IF NOT EXISTS source_file_key VARCHAR;
