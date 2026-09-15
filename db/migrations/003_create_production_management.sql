-- Production lines are database entities.  Keep the legacy work_orders.line
-- text column so existing records and integrations remain readable.
CREATE TABLE IF NOT EXISTS production_lines (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Some deployed databases used an earlier text-keyed production_lines table
-- (line_id/status). Add the new columns in-place so its records survive.
ALTER TABLE production_lines ADD COLUMN IF NOT EXISTS id SERIAL;
ALTER TABLE production_lines ADD COLUMN IF NOT EXISTS is_active BOOLEAN;
UPDATE production_lines
SET is_active = CASE WHEN to_jsonb(production_lines)->>'status' = 'Inactive' THEN FALSE ELSE TRUE END
WHERE is_active IS NULL;
ALTER TABLE production_lines ALTER COLUMN is_active SET DEFAULT TRUE;
ALTER TABLE production_lines ALTER COLUMN is_active SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS production_lines_id_unique_idx ON production_lines(id);
CREATE UNIQUE INDEX IF NOT EXISTS production_lines_name_unique_idx ON production_lines(name);

CREATE TABLE IF NOT EXISTS line_item_rates (
  line_id INTEGER NOT NULL REFERENCES production_lines(id),
  product_id TEXT NOT NULL REFERENCES products(product_id),
  units_per_hour NUMERIC(12, 3) NOT NULL CHECK (units_per_hour > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (line_id, product_id)
);

-- The application already has a molds table with stable text mold_id values.
-- Extend it instead of replacing it, preserving all existing FK references.
ALTER TABLE molds ADD COLUMN IF NOT EXISTS code VARCHAR(100);
ALTER TABLE molds ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
CREATE UNIQUE INDEX IF NOT EXISTS molds_code_unique_idx ON molds(code) WHERE code IS NOT NULL;

CREATE TABLE IF NOT EXISTS item_mold_options (
  product_id TEXT NOT NULL REFERENCES products(product_id),
  mold_id TEXT NOT NULL REFERENCES molds(mold_id),
  is_preferred BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, mold_id)
);

ALTER TABLE work_orders ADD COLUMN IF NOT EXISTS line_id INTEGER REFERENCES production_lines(id);

CREATE INDEX IF NOT EXISTS idx_production_lines_active ON production_lines(is_active);
CREATE INDEX IF NOT EXISTS idx_line_item_rates_product ON line_item_rates(product_id);
CREATE INDEX IF NOT EXISTS idx_item_mold_options_mold ON item_mold_options(mold_id);
CREATE INDEX IF NOT EXISTS idx_work_orders_line_id ON work_orders(line_id);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'production_lines' AND column_name = 'line_id'
  ) THEN
    INSERT INTO production_lines(line_id, name, is_active)
    VALUES ('L1', 'L1', TRUE), ('L2', 'L2', TRUE), ('L3', 'L3', TRUE)
    ON CONFLICT (line_id) DO NOTHING;
  ELSE
    INSERT INTO production_lines(name) VALUES ('L1'), ('L2'), ('L3') ON CONFLICT (name) DO NOTHING;
  END IF;
END $$;

-- Make existing mold/product assignments available through the new option table.
INSERT INTO item_mold_options(product_id, mold_id, is_preferred)
SELECT product_id, mold_id, TRUE FROM products WHERE mold_id IS NOT NULL
ON CONFLICT (product_id, mold_id) DO NOTHING;

-- Link legacy work orders where their line name matches a managed production line.
UPDATE work_orders AS wo SET line_id = pl.id
FROM production_lines AS pl
WHERE wo.line_id IS NULL AND wo.line = pl.name;
