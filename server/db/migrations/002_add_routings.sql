-- 1. Create product_routings table
CREATE TABLE product_routings (
  routing_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(product_id),
  step_number INTEGER NOT NULL,
  operation_name TEXT NOT NULL,
  cycle_minutes INTEGER NOT NULL,
  mold_id TEXT REFERENCES molds(mold_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Migrate existing data from products to product_routings
INSERT INTO product_routings (routing_id, product_id, step_number, operation_name, cycle_minutes, mold_id)
SELECT 
  product_id || '-OP10' as routing_id, 
  product_id, 
  10 as step_number, 
  '主要工序' as operation_name, 
  cycle_minutes, 
  mold_id 
FROM products;

-- 3. Drop columns from products
ALTER TABLE products 
  DROP COLUMN cycle_minutes,
  DROP COLUMN mold_id;
