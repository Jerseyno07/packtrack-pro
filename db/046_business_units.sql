-- Business Unit (BU): every facility belongs to exactly one BU; every user can
-- belong to many BUs. BU is an additional access-control filter layered on top
-- of the existing user_warehouses assignment (see server/index.js's
-- getEffectiveWarehouseIds). PM_STORE_EXEC users are exempt from BU filtering.

CREATE TABLE business_units (
  id          BIGSERIAL PRIMARY KEY,
  code        VARCHAR(40) UNIQUE NOT NULL,
  name        VARCHAR(120) NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO business_units (code, name) VALUES ('FLIPKART', 'Flipkart');

ALTER TABLE warehouses ADD COLUMN business_unit_id BIGINT REFERENCES business_units(id);
UPDATE warehouses SET business_unit_id = (SELECT id FROM business_units WHERE code = 'FLIPKART');
ALTER TABLE warehouses ALTER COLUMN business_unit_id SET NOT NULL;
ALTER TABLE warehouses DROP COLUMN bu;

CREATE TABLE user_business_units (
  user_id           BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  business_unit_id  BIGINT NOT NULL REFERENCES business_units(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, business_unit_id)
);

-- Backfill every existing user into the default BU so access is unchanged on deploy.
INSERT INTO user_business_units (user_id, business_unit_id)
SELECT id, (SELECT id FROM business_units WHERE code = 'FLIPKART') FROM users;
