-- 008_create_product_routings.sql
--
-- 建立 product_routings 表，供 /api/routings 使用。
-- 此 migration 只建立資料表，不搬移資料、不修改 products schema。

CREATE TABLE IF NOT EXISTS product_routings (
  routing_id     TEXT        PRIMARY KEY,
  product_id     TEXT        NOT NULL REFERENCES products(product_id),
  step_number    INTEGER     NOT NULL,
  operation_name TEXT        NOT NULL,
  cycle_minutes  INTEGER     NOT NULL,
  mold_id        TEXT        REFERENCES molds(mold_id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
