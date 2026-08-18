const { execFileSync } = require('child_process');

const CONTAINER_NAME = 'practice_project2-postgres-1';
const DB_USER = 'postgres';
const DB_NAME = 'practice_project2';

function dockerExec(args) {
  return execFileSync(
    'docker',
    ['exec', '-i', CONTAINER_NAME, ...args],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    }
  );
}

// 執行 INSERT / UPDATE / DELETE
function dockerPsql(sql) {
  try {
    return dockerExec([
      'psql',
      '-U',
      DB_USER,
      '-d',
      DB_NAME,
      '-v',
      'ON_ERROR_STOP=1',
      '-c',
      sql,
    ]);
  } catch (error) {
    const stderr = error.stderr?.toString() || '';

    throw new Error(
      `Docker PostgreSQL SQL 執行失敗\n${stderr || error.message}`
    );
  }
}

// 執行 SELECT，回傳 JSON
function dockerPsqlQuery(sql) {
  try {
    const output = dockerExec([
      'psql',
      '-U',
      DB_USER,
      '-d',
      DB_NAME,
      '-v',
      'ON_ERROR_STOP=1',
      '-t',
      '-A',
      '-F',
      '\t',
      '-c',
      sql,
    ]);

    const text = output.trim();

    if (!text) {
      return [];
    }

    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.split('\t'));
  } catch (error) {
    const stderr = error.stderr?.toString() || '';

    throw new Error(
      `Docker PostgreSQL Query 執行失敗\n${stderr || error.message}`
    );
  }
}

function escapeSql(value) {
  return String(value).replace(/'/g, "''");
}

function waitForPostgres() {
  try {
    dockerExec([
      'pg_isready',
      '-U',
      DB_USER,
      '-d',
      DB_NAME,
    ]);

    return true;
  } catch {
    return false;
  }
}

function setupE2EAdmin() {
  dockerPsql(`
    INSERT INTO users (user_id, name, role)
    VALUES ('E2E-ADMIN', 'E2E Admin User', 'admin')
    ON CONFLICT (user_id) DO UPDATE
    SET name = EXCLUDED.name,
        role = EXCLUDED.role,
        updated_at = now();
  `);
}

function clearE2EData() {
  dockerPsql(`
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

function seedE2EData() {
  setupE2EAdmin();

  dockerPsql(`
    INSERT INTO materials
      (material_id, name, unit, stock, capacity, safety_stock, location)
    VALUES
      ('E2E-MAT-CREATE', 'E2E Material Create', 'pcs', 100, 1000, 10, 'E2E-A1'),
      ('E2E-MAT-START', 'E2E Material Start', 'pcs', 100, 1000, 10, 'E2E-A2'),
      ('E2E-MAT-COMPLETE', 'E2E Material Complete', 'pcs', 100, 1000, 10, 'E2E-A3'),
      ('E2E-MAT-REJECT', 'E2E Material Reject', 'pcs', 100, 1000, 10, 'E2E-A4'),
      ('E2E-MAT-BUSY', 'E2E Material Busy', 'pcs', 100, 1000, 10, 'E2E-A5'),
      ('E2E-MAT-LOW', 'E2E Material Low', 'pcs', 10, 1000, 10, 'E2E-A6'),
      ('E2E-MAT-INVALID', 'E2E Material Invalid', 'pcs', 100, 1000, 10, 'E2E-A7');

    INSERT INTO molds
      (mold_id, name, status, line)
    VALUES
      ('E2E-MOLD-CREATE', 'E2E Mold Create', 'Idle', 'L1'),
      ('E2E-MOLD-START', 'E2E Mold Start', 'Idle', 'L1'),
      ('E2E-MOLD-COMPLETE', 'E2E Mold Complete', 'Idle', 'L1'),
      ('E2E-MOLD-REJECT', 'E2E Mold Reject', 'Idle', 'L1'),
      ('E2E-MOLD-BUSY', 'E2E Mold Busy', 'In_Use', 'L1'),
      ('E2E-MOLD-LOW', 'E2E Mold Low', 'Idle', 'L1'),
      ('E2E-MOLD-INVALID', 'E2E Mold Invalid', 'Idle', 'L1');

    INSERT INTO products
      (product_id, name, cycle_minutes, mold_id, stock)
    VALUES
      ('E2E-PRD-CREATE', 'E2E Product Create', 10, 'E2E-MOLD-CREATE', 0),
      ('E2E-PRD-START', 'E2E Product Start', 10, 'E2E-MOLD-START', 0),
      ('E2E-PRD-COMPLETE', 'E2E Product Complete', 10, 'E2E-MOLD-COMPLETE', 0),
      ('E2E-PRD-REJECT', 'E2E Product Reject', 10, 'E2E-MOLD-REJECT', 0),
      ('E2E-PRD-BUSY', 'E2E Product Busy', 10, 'E2E-MOLD-BUSY', 0),
      ('E2E-PRD-LOW', 'E2E Product Low', 10, 'E2E-MOLD-LOW', 0),
      ('E2E-PRD-INVALID', 'E2E Product Invalid', 10, 'E2E-MOLD-INVALID', 0);

    INSERT INTO bom_table
      (bom_id, product_id, material_id, amount_per_unit)
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
  waitForPostgres,
  dockerPsql,
  dockerPsqlQuery,
  escapeSql,
  setupE2EAdmin,
  seedE2EData,
  clearE2EData,
};