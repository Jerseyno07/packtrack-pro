-- Append-only price-change history for materials.master_price — mirrors
-- stock_ledger's narrow, typed, never-overwrite pattern. A row is inserted
-- only when a price upload actually changes the value (see
-- POST /api/v1/materials/price-upload), so this stays a real change log,
-- not a row-per-upload-attempt noise table.
CREATE TABLE material_price_history (
  id            BIGSERIAL PRIMARY KEY,
  material_id   BIGINT NOT NULL REFERENCES materials(id),
  material_code VARCHAR(30) NOT NULL,
  old_price     NUMERIC(12,2) NOT NULL,
  new_price     NUMERIC(12,2) NOT NULL,
  changed_by    BIGINT REFERENCES users(id),
  source_file   VARCHAR(255),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_mph_material ON material_price_history(material_id, created_at DESC);
