const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DATABASE_HOST || process.env.TEST_DB_HOST || 'localhost',
  port: Number(process.env.DATABASE_PORT || process.env.TEST_DB_PORT || 5432),
  database: process.env.DATABASE_NAME || process.env.TEST_DB_NAME || 'practice_project2',
  user: process.env.DATABASE_USER || process.env.TEST_DB_USER || 'postgres',
  password: process.env.DATABASE_PASSWORD || process.env.TEST_DB_PASSWORD || 'postgres',
});

async function setupE2EAdmin() {
  await pool.query(
    `INSERT INTO users (user_id, name, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id) DO UPDATE
       SET name = EXCLUDED.name,
           role = EXCLUDED.role,
           updated_at = now()`,
    ['E2E-ADMIN', 'E2E Admin User', 'admin']
  );
}

async function clearE2EData() {
  await pool.query(`
    DELETE FROM system_logs
    WHERE work_order_id IN (
      SELECT work_order_id
      FROM work_orders
      WHERE work_order_id LIKE 'E2E-%'
        OR product_id LIKE 'E2E-%'
        OR mold_id LIKE 'E2E-%'
        OR creator_user_id LIKE 'E2E-%'
    )
    OR created_by_user_id LIKE 'E2E-%';

    DELETE FROM inventory_transactions
    WHERE work_order_id IN (
      SELECT work_order_id
      FROM work_orders
      WHERE work_order_id LIKE 'E2E-%'
        OR product_id LIKE 'E2E-%'
        OR mold_id LIKE 'E2E-%'
        OR creator_user_id LIKE 'E2E-%'
    )
    OR material_id LIKE 'E2E-%'
    OR product_id LIKE 'E2E-%'
    OR created_by_user_id LIKE 'E2E-%';

    DELETE FROM work_orders
    WHERE work_order_id LIKE 'E2E-%'
       OR product_id LIKE 'E2E-%'
       OR mold_id LIKE 'E2E-%'
       OR creator_user_id LIKE 'E2E-%';

    DELETE FROM bom_table
    WHERE bom_id LIKE 'E2E-%'
       OR product_id LIKE 'E2E-%'
       OR material_id LIKE 'E2E-%';

    DELETE FROM products
    WHERE product_id LIKE 'E2E-%'
       OR mold_id LIKE 'E2E-%';

    DELETE FROM molds
    WHERE mold_id LIKE 'E2E-%'
       OR product_id LIKE 'E2E-%';

    DELETE FROM materials
    WHERE material_id LIKE 'E2E-%';

    DELETE FROM users
    WHERE user_id LIKE 'E2E-%';
  `);
}

async function seedE2EData() {
  await setupE2EAdmin();

  await pool.query(`
    INSERT INTO materials (material_id, name, unit, stock, capacity, safety_stock, location)
    VALUES
      ('E2E-MAT-CREATE', 'E2E Material Create', 'pcs', 100, 1000, 10, 'E2E-A1'),
      ('E2E-MAT-START', 'E2E Material Start', 'pcs', 100, 1000, 10, 'E2E-A2'),
      ('E2E-MAT-COMPLETE', 'E2E Material Complete', 'pcs', 100, 1000, 10, 'E2E-A3'),
      ('E2E-MAT-REJECT', 'E2E Material Reject', 'pcs', 100, 1000, 10, 'E2E-A4'),
      ('E2E-MAT-BUSY', 'E2E Material Busy', 'pcs', 100, 1000, 10, 'E2E-A5'),
      ('E2E-MAT-LOW', 'E2E Material Low', 'pcs', 10, 1000, 10, 'E2E-A6'),
      ('E2E-MAT-INVALID', 'E2E Material Invalid', 'pcs', 100, 1000, 10, 'E2E-A7');

    INSERT INTO molds (mold_id, name, status, line)
    VALUES
      ('E2E-MOLD-CREATE', 'E2E Mold Create', 'Idle', 'L1'),
      ('E2E-MOLD-START', 'E2E Mold Start', 'Idle', 'L1'),
      ('E2E-MOLD-COMPLETE', 'E2E Mold Complete', 'Idle', 'L1'),
      ('E2E-MOLD-REJECT', 'E2E Mold Reject', 'Idle', 'L1'),
      ('E2E-MOLD-BUSY', 'E2E Mold Busy', 'In_Use', 'L1'),
      ('E2E-MOLD-LOW', 'E2E Mold Low', 'Idle', 'L1'),
      ('E2E-MOLD-INVALID', 'E2E Mold Invalid', 'Idle', 'L1');

    INSERT INTO products (product_id, name, cycle_minutes, mold_id, stock)
    VALUES
      ('E2E-PRD-CREATE', 'E2E Product Create', 10, 'E2E-MOLD-CREATE', 0),
      ('E2E-PRD-START', 'E2E Product Start', 10, 'E2E-MOLD-START', 0),
      ('E2E-PRD-COMPLETE', 'E2E Product Complete', 10, 'E2E-MOLD-COMPLETE', 0),
      ('E2E-PRD-REJECT', 'E2E Product Reject', 10, 'E2E-MOLD-REJECT', 0),
      ('E2E-PRD-BUSY', 'E2E Product Busy', 10, 'E2E-MOLD-BUSY', 0),
      ('E2E-PRD-LOW', 'E2E Product Low', 10, 'E2E-MOLD-LOW', 0),
      ('E2E-PRD-INVALID', 'E2E Product Invalid', 10, 'E2E-MOLD-INVALID', 0);

    INSERT INTO bom_table (bom_id, product_id, material_id, amount_per_unit)
    VALUES
      ('E2E-BOM-CREATE', 'E2E-PRD-CREATE', 'E2E-MAT-CREATE', 2),
      ('E2E-BOM-START', 'E2E-PRD-START', 'E2E-MAT-START', 2),
      ('E2E-BOM-COMPLETE', 'E2E-PRD-COMPLETE', 'E2E-MAT-COMPLETE', 2),
      ('E2E-BOM-REJECT', 'E2E-PRD-REJECT', 'E2E-MAT-REJECT', 2),
      ('E2E-BOM-BUSY', 'E2E-PRD-BUSY', 'E2E-MAT-BUSY', 2),
      ('E2E-BOM-LOW', 'E2E-PRD-LOW', 'E2E-MAT-LOW', 20),
      ('E2E-BOM-INVALID', 'E2E-PRD-INVALID', 'E2E-MAT-INVALID', 2);
  `);
}

module.exports = {
  pool,
  setupE2EAdmin,
  seedE2EData,
  clearE2EData,
};
