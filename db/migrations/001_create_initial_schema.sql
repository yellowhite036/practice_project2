CREATE TABLE users (
  user_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT users_role_check CHECK (role IN ('operator', 'admin', 'manager'))
);

CREATE TABLE materials (
  material_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  stock NUMERIC(14, 3) NOT NULL DEFAULT 0,
  capacity NUMERIC(14, 3),
  safety_stock NUMERIC(14, 3) NOT NULL DEFAULT 0,
  location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT materials_stock_check CHECK (stock >= 0),
  CONSTRAINT materials_capacity_check CHECK (capacity IS NULL OR capacity >= 0),
  CONSTRAINT materials_safety_stock_check CHECK (safety_stock >= 0),
  CONSTRAINT materials_version_check CHECK (version > 0)
);

CREATE TABLE molds (
  mold_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Idle',
  line TEXT,
  eta TIMESTAMPTZ,
  product_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT molds_status_check CHECK (status IN ('Idle', 'In_Use')),
  CONSTRAINT molds_version_check CHECK (version > 0)
);

CREATE TABLE products (
  product_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  cycle_minutes INTEGER NOT NULL,
  mold_id TEXT,
  stock INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT products_mold_id_fk FOREIGN KEY (mold_id) REFERENCES molds (mold_id),
  CONSTRAINT products_cycle_minutes_check CHECK (cycle_minutes > 0),
  CONSTRAINT products_stock_check CHECK (stock >= 0),
  CONSTRAINT products_version_check CHECK (version > 0)
);

CREATE TABLE bom_table (
  bom_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  material_id TEXT NOT NULL,
  amount_per_unit NUMERIC(14, 3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  version INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT bom_table_product_id_fk FOREIGN KEY (product_id) REFERENCES products (product_id),
  CONSTRAINT bom_table_material_id_fk FOREIGN KEY (material_id) REFERENCES materials (material_id),
  CONSTRAINT bom_table_product_material_unique UNIQUE (product_id, material_id),
  CONSTRAINT bom_table_amount_per_unit_check CHECK (amount_per_unit > 0),
  CONSTRAINT bom_table_version_check CHECK (version > 0)
);

CREATE TABLE work_orders (
  work_order_id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  line TEXT NOT NULL,
  mold_id TEXT NOT NULL,
  status TEXT NOT NULL,
  creator_user_id TEXT,
  creator_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT work_orders_product_id_fk FOREIGN KEY (product_id) REFERENCES products (product_id),
  CONSTRAINT work_orders_mold_id_fk FOREIGN KEY (mold_id) REFERENCES molds (mold_id),
  CONSTRAINT work_orders_creator_user_id_fk FOREIGN KEY (creator_user_id) REFERENCES users (user_id),
  CONSTRAINT work_orders_quantity_check CHECK (quantity > 0),
  CONSTRAINT work_orders_status_check CHECK (status IN ('Pending', 'In_Progress', 'Completed', 'Rejected'))
);

CREATE TABLE inventory_transactions (
  transaction_id BIGSERIAL PRIMARY KEY,
  work_order_id TEXT,
  material_id TEXT,
  product_id TEXT,
  transaction_type TEXT NOT NULL,
  quantity NUMERIC(14, 3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by_user_id TEXT,
  CONSTRAINT inventory_transactions_work_order_id_fk FOREIGN KEY (work_order_id) REFERENCES work_orders (work_order_id),
  CONSTRAINT inventory_transactions_material_id_fk FOREIGN KEY (material_id) REFERENCES materials (material_id),
  CONSTRAINT inventory_transactions_product_id_fk FOREIGN KEY (product_id) REFERENCES products (product_id),
  CONSTRAINT inventory_transactions_created_by_user_id_fk FOREIGN KEY (created_by_user_id) REFERENCES users (user_id),
  CONSTRAINT inventory_transactions_transaction_type_check CHECK (
    transaction_type IN ('consume', 'restock', 'produce', 'adjust')
  )
);

CREATE TABLE system_logs (
  log_id BIGSERIAL PRIMARY KEY,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  work_order_id TEXT,
  created_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT system_logs_work_order_id_fk FOREIGN KEY (work_order_id) REFERENCES work_orders (work_order_id),
  CONSTRAINT system_logs_created_by_user_id_fk FOREIGN KEY (created_by_user_id) REFERENCES users (user_id),
  CONSTRAINT system_logs_level_check CHECK (level IN ('INFO', 'WARN', 'ERR'))
);

CREATE INDEX materials_name_idx ON materials (name);
CREATE INDEX products_name_idx ON products (name);
CREATE INDEX products_mold_id_idx ON products (mold_id);
CREATE INDEX molds_status_idx ON molds (status);
CREATE INDEX molds_product_id_idx ON molds (product_id);
CREATE INDEX bom_table_product_id_idx ON bom_table (product_id);
CREATE INDEX bom_table_material_id_idx ON bom_table (material_id);
CREATE INDEX work_orders_product_id_idx ON work_orders (product_id);
CREATE INDEX work_orders_mold_id_idx ON work_orders (mold_id);
CREATE INDEX work_orders_status_idx ON work_orders (status);
CREATE INDEX inventory_transactions_material_id_idx ON inventory_transactions (material_id);
CREATE INDEX inventory_transactions_product_id_idx ON inventory_transactions (product_id);
CREATE INDEX inventory_transactions_work_order_id_idx ON inventory_transactions (work_order_id);
CREATE INDEX inventory_transactions_created_at_idx ON inventory_transactions (created_at);
CREATE INDEX system_logs_work_order_id_idx ON system_logs (work_order_id);
CREATE INDEX system_logs_level_idx ON system_logs (level);
CREATE INDEX system_logs_created_at_idx ON system_logs (created_at);
