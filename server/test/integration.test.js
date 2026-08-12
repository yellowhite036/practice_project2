const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");

const DB_HOST = process.env.TEST_DB_HOST || "localhost";
const DB_PORT = process.env.TEST_DB_PORT || "5432";
const DB_NAME = process.env.TEST_DB_NAME || "practice_project2_test";
const DB_USER = process.env.TEST_DB_USER || "postgres";
const DB_PASSWORD = process.env.TEST_DB_PASSWORD || "postgres";
const JWT_SECRET =
  process.env.JWT_SECRET || "test_secret_integration";

process.env.DATABASE_HOST = DB_HOST;
process.env.DATABASE_PORT = DB_PORT;
process.env.DATABASE_NAME = DB_NAME;
process.env.DATABASE_USER = DB_USER;
process.env.DATABASE_PASSWORD = DB_PASSWORD;
process.env.JWT_SECRET = JWT_SECRET;

const adminToken = jwt.sign(
  {
    user_id: "ADMIN-TEST",
    role: "admin",
  },
  JWT_SECRET
);

const createApp = require("../src/app");

let pool;
let app;

function request(appInstance, method, requestPath, body, options = {}) {
  const server = http.createServer(appInstance);

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();

      const payload =
        body === undefined || body === null
          ? null
          : JSON.stringify(body);

      const headers = {
        Authorization: `Bearer ${adminToken}`,
        ...(options.headers || {}),
      };

      if (payload !== null) {
        headers["content-type"] = "application/json";
        headers["content-length"] = Buffer.byteLength(payload);
      }

      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          method,
          path: requestPath,
          headers,
        },
        (res) => {
          let data = "";

          res.on("data", (chunk) => {
            data += chunk;
          });

          res.on("end", () => {
            server.close();

            let parsed;

            try {
              parsed = JSON.parse(data);
            } catch {
              parsed = data;
            }

            resolve({
              statusCode: res.statusCode,
              headers: res.headers,
              body: parsed,
            });
          });
        }
      );

      req.on("error", (error) => {
        server.close();
        reject(error);
      });

      if (payload !== null) {
        req.write(payload);
      }

      req.end();
    });
  });
}

async function runMigration() {
  const sql = await fs.readFile(
    path.join(
      __dirname,
      "../../db/migrations/001_create_initial_schema.sql"
    ),
    "utf8"
  );

  await pool.query(sql);
}

async function cleanData() {
  await pool.query(`
    TRUNCATE TABLE
      system_logs,
      inventory_transactions,
      work_orders,
      bom_table,
      products,
      molds,
      materials,
      users
    CASCADE;
  `);
}

async function seedBaseData() {
  await cleanData();

  await pool.query(`
    INSERT INTO users (
      user_id,
      name,
      role
    )
    VALUES (
      'ADMIN-TEST',
      'Admin User',
      'admin'
    );

    INSERT INTO materials (
      material_id,
      name,
      unit,
      stock,
      capacity,
      safety_stock
    )
    VALUES
      ('MAT-A', 'Material A', 'kg', 100, 500, 10),
      ('MAT-B', 'Material B', 'pcs', 10, 50, 5);

    INSERT INTO molds (
      mold_id,
      name,
      status,
      line
    )
    VALUES
      ('MOLD-1', 'Mold 1', 'Idle', 'L1'),
      ('MOLD-2', 'Mold 2', 'In_Use', 'L2');

    INSERT INTO products (
      product_id,
      name,
      cycle_minutes,
      mold_id,
      stock
    )
    VALUES
      ('PRD-1', 'Product 1', 10, 'MOLD-1', 0);

    INSERT INTO bom_table (
      bom_id,
      product_id,
      material_id,
      amount_per_unit
    )
    VALUES
      ('BOM-1', 'PRD-1', 'MAT-A', 2),
      ('BOM-2', 'PRD-1', 'MAT-B', 1);
  `);
}

async function checkDatabaseAvailable() {
  let tempPool;

  try {
    tempPool = new Pool({
      host: DB_HOST,
      port: DB_PORT,
      database: DB_NAME,
      user: DB_USER,
      password: DB_PASSWORD,
    });

    await tempPool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    if (tempPool) {
      await tempPool.end().catch(() => { });
    }
  }
}

function assertResponseStatus(response, expectedStatus, label) {
  if (response.statusCode !== expectedStatus) {
    assert.fail(
      `${label}\n` +
      `Expected HTTP ${expectedStatus}, got ${response.statusCode}\n` +
      `Response: ${JSON.stringify(response.body)}`
    );
  }
}

test("PostgreSQL Integration Tests", async (t) => {
  const available = await checkDatabaseAvailable();

  if (!available) {
    console.log(
      "PostgreSQL integration tests: NOT RUN - PostgreSQL environment unavailable"
    );

    t.skip("PostgreSQL environment unavailable");
    return;
  }

  pool = new Pool({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
  });

  try {
    await pool.query(`
      DROP SCHEMA public CASCADE;
      CREATE SCHEMA public;
    `);

    await runMigration();
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  }

  app = createApp({ pool });

  t.after(async () => {
    await pool.end();
  });

  await t.test(
    "1. Work Order 正常建立 & BOM 數量計算",
    async () => {
      await seedBaseData();

      const response = await request(
        app,
        "POST",
        "/api/work-orders",
        {
          work_order_id: "WO-TEST-1",
          product_id: "PRD-1",
          quantity: 5,
          line: "L1",
          mold_id: "MOLD-1",
        }
      );

      assertResponseStatus(
        response,
        201,
        "Work Order creation failed"
      );

      const woResult = await pool.query(`
        SELECT status
        FROM work_orders
        WHERE work_order_id = 'WO-TEST-1'
      `);

      assert.equal(woResult.rows.length, 1);
      assert.equal(woResult.rows[0].status, "Pending");

      const matA = await pool.query(`
        SELECT stock
        FROM materials
        WHERE material_id = 'MAT-A'
      `);

      const matB = await pool.query(`
        SELECT stock
        FROM materials
        WHERE material_id = 'MAT-B'
      `);

      assert.equal(Number(matA.rows[0].stock), 90);
      assert.equal(Number(matB.rows[0].stock), 5);

      const mold = await pool.query(`
        SELECT status
        FROM molds
        WHERE mold_id = 'MOLD-1'
      `);

      assert.equal(mold.rows[0].status, "In_Use");

      const inventory = await pool.query(`
        SELECT
          material_id,
          quantity,
          transaction_type
        FROM inventory_transactions
        WHERE work_order_id = 'WO-TEST-1'
        ORDER BY material_id
      `);

      assert.equal(inventory.rows.length, 2);

      assert.ok(
        inventory.rows.some(
          (row) =>
            row.material_id === "MAT-A" &&
            Number(row.quantity) === -10 &&
            row.transaction_type === "consume"
        )
      );

      assert.ok(
        inventory.rows.some(
          (row) =>
            row.material_id === "MAT-B" &&
            Number(row.quantity) === -5 &&
            row.transaction_type === "consume"
        )
      );

      const logs = await pool.query(`
        SELECT level
        FROM system_logs
        WHERE work_order_id = 'WO-TEST-1'
      `);

      assert.ok(logs.rows.length > 0);
    }
  );

  await t.test(
    "2. Product stock lifecycle & Mold lifecycle",
    async () => {
      await seedBaseData();

      const createResponse = await request(
        app,
        "POST",
        "/api/work-orders",
        {
          work_order_id: "WO-TEST-2",
          product_id: "PRD-1",
          quantity: 10,
          line: "L1",
          mold_id: "MOLD-1",
        }
      );

      assertResponseStatus(
        createResponse,
        201,
        "Work Order creation failed"
      );

      let product = await pool.query(`
        SELECT stock
        FROM products
        WHERE product_id = 'PRD-1'
      `);

      assert.equal(Number(product.rows[0].stock), 0);

      const startResponse = await request(
        app,
        "PUT",
        "/api/work-orders/WO-TEST-2",
        {
          action: "start",
        }
      );

      assertResponseStatus(
        startResponse,
        200,
        "Work Order START failed"
      );

      assert.equal(
        startResponse.body.status,
        "In_Progress"
      );

      const completeResponse = await request(
        app,
        "PUT",
        "/api/work-orders/WO-TEST-2",
        {
          action: "complete",
        }
      );

      assertResponseStatus(
        completeResponse,
        200,
        "Work Order COMPLETE failed"
      );

      assert.equal(
        completeResponse.body.status,
        "Completed"
      );

      product = await pool.query(`
        SELECT stock
        FROM products
        WHERE product_id = 'PRD-1'
      `);

      assert.equal(Number(product.rows[0].stock), 10);

      const mold = await pool.query(`
        SELECT status
        FROM molds
        WHERE mold_id = 'MOLD-1'
      `);

      assert.equal(mold.rows[0].status, "Idle");

      const inventory = await pool.query(`
        SELECT
          transaction_type,
          quantity
        FROM inventory_transactions
        WHERE work_order_id = 'WO-TEST-2'
          AND product_id = 'PRD-1'
      `);

      assert.equal(inventory.rows.length, 1);
      assert.equal(
        inventory.rows[0].transaction_type,
        "produce"
      );
      assert.equal(
        Number(inventory.rows[0].quantity),
        10
      );
    }
  );

  await t.test(
    "3. Work Order Reject rollback",
    async () => {
      await seedBaseData();

      const createResponse = await request(
        app,
        "POST",
        "/api/work-orders",
        {
          work_order_id: "WO-TEST-REJ",
          product_id: "PRD-1",
          quantity: 5,
          line: "L1",
          mold_id: "MOLD-1",
        }
      );

      assertResponseStatus(
        createResponse,
        201,
        "Work Order creation failed"
      );

      const rejectResponse = await request(
        app,
        "PUT",
        "/api/work-orders/WO-TEST-REJ",
        {
          action: "reject",
        }
      );

      assertResponseStatus(
        rejectResponse,
        200,
        "Work Order REJECT failed"
      );

      assert.equal(
        rejectResponse.body.status,
        "Rejected"
      );

      const workOrder = await pool.query(`
        SELECT status
        FROM work_orders
        WHERE work_order_id = 'WO-TEST-REJ'
      `);

      assert.equal(
        workOrder.rows[0].status,
        "Rejected"
      );

      const mold = await pool.query(`
        SELECT status
        FROM molds
        WHERE mold_id = 'MOLD-1'
      `);

      assert.equal(
        mold.rows[0].status,
        "Idle"
      );
    }
  );

  await t.test(
    "4. Transaction rollback when Mold is In_Use",
    async () => {
      await seedBaseData();

      const response = await request(
        app,
        "POST",
        "/api/work-orders",
        {
          work_order_id: "WO-FAIL",
          product_id: "PRD-1",
          quantity: 5,
          line: "L1",
          mold_id: "MOLD-2",
        }
      );

      assert.ok(
        [400, 409].includes(response.statusCode),
        `Unexpected status ${response.statusCode}: ${JSON.stringify(
          response.body
        )}`
      );

      const workOrder = await pool.query(`
        SELECT *
        FROM work_orders
        WHERE work_order_id = 'WO-FAIL'
      `);

      assert.equal(workOrder.rows.length, 0);

      const matA = await pool.query(`
        SELECT stock
        FROM materials
        WHERE material_id = 'MAT-A'
      `);

      const matB = await pool.query(`
        SELECT stock
        FROM materials
        WHERE material_id = 'MAT-B'
      `);

      assert.equal(Number(matA.rows[0].stock), 100);
      assert.equal(Number(matB.rows[0].stock), 10);

      const inventory = await pool.query(`
        SELECT *
        FROM inventory_transactions
        WHERE work_order_id = 'WO-FAIL'
      `);

      assert.equal(inventory.rows.length, 0);

      const mold = await pool.query(`
        SELECT status
        FROM molds
        WHERE mold_id = 'MOLD-2'
      `);

      assert.equal(
        mold.rows[0].status,
        "In_Use"
      );
    }
  );

  await t.test(
    "5. Work Order quantity validation",
    async () => {
      await seedBaseData();

      const response = await request(
        app,
        "POST",
        "/api/work-orders",
        {
          work_order_id: "WO-ZERO",
          product_id: "PRD-1",
          quantity: 0,
          line: "L1",
          mold_id: "MOLD-1",
        }
      );

      assertResponseStatus(
        response,
        400,
        "Quantity validation failed"
      );

      const count = await pool.query(`
        SELECT COUNT(*) AS count
        FROM work_orders
        WHERE work_order_id = 'WO-ZERO'
      `);

      assert.equal(
        Number(count.rows[0].count),
        0
      );
    }
  );

  await t.test(
    "6. PostgreSQL constraints",
    async () => {
      await seedBaseData();

      const duplicateMaterial = await request(
        app,
        "POST",
        "/api/materials",
        {
          material_id: "MAT-A",
          name: "Duplicate",
          unit: "kg",
          stock: 10,
          capacity: 100,
          safety_stock: 1,
        }
      );

      assertResponseStatus(
        duplicateMaterial,
        409,
        "UNIQUE constraint test failed"
      );

      const invalidProduct = await request(
        app,
        "POST",
        "/api/products",
        {
          product_id: "PRD-NEW",
          name: "New Product",
          cycle_minutes: 10,
          mold_id: "MOLD-NOT-EXIST",
          stock: 0,
        }
      );

      assertResponseStatus(
        invalidProduct,
        409,
        "FOREIGN KEY constraint test failed"
      );

      const negativeMaterial = await request(
        app,
        "POST",
        "/api/materials",
        {
          material_id: "MAT-NEG",
          name: "Negative Stock",
          unit: "kg",
          stock: -10,
          capacity: 100,
          safety_stock: 0,
        }
      );

      assertResponseStatus(
        negativeMaterial,
        409,
        "CHECK constraint test failed"
      );
    }
  );

  await t.test(
    "7. Optimistic Lock",
    async () => {
      await seedBaseData();

      const missingVersion = await request(
        app,
        "PUT",
        "/api/materials/MAT-A",
        {
          material_id: "MAT-A",
          name: "New Name",
          unit: "kg",
          stock: 100,
        }
      );

      assertResponseStatus(
        missingVersion,
        400,
        "Missing version validation failed"
      );

      const incorrectVersion = await request(
        app,
        "PUT",
        "/api/materials/MAT-A",
        {
          material_id: "MAT-A",
          name: "New Name",
          unit: "kg",
          stock: 100,
          capacity: 500,
          safety_stock: 10,
          version: 999,
        }
      );

      assertResponseStatus(
        incorrectVersion,
        409,
        "Incorrect version validation failed"
      );

      const correctVersion = await request(
        app,
        "PUT",
        "/api/materials/MAT-A",
        {
          material_id: "MAT-A",
          name: "New Name",
          unit: "kg",
          stock: 110,
          capacity: 500,
          safety_stock: 10,
          version: 1,
        }
      );

      assertResponseStatus(
        correctVersion,
        200,
        "Correct version update failed"
      );

      const material = await pool.query(`
        SELECT stock, version
        FROM materials
        WHERE material_id = 'MAT-A'
      `);

      assert.equal(
        Number(material.rows[0].stock),
        110
      );

      assert.equal(
        material.rows[0].version,
        2
      );
    }
  );

  await t.test(
    "8. Invalid Work Order state transition",
    async () => {
      await seedBaseData();

      const createResponse = await request(
        app,
        "POST",
        "/api/work-orders",
        {
          work_order_id: "WO-TEST-3",
          product_id: "PRD-1",
          quantity: 10,
          line: "L1",
          mold_id: "MOLD-1",
        }
      );

      assertResponseStatus(
        createResponse,
        201,
        "Work Order creation failed"
      );

      const startResponse = await request(
        app,
        "PUT",
        "/api/work-orders/WO-TEST-3",
        {
          action: "start",
        }
      );

      assertResponseStatus(
        startResponse,
        200,
        "Work Order START failed"
      );

      const completeResponse = await request(
        app,
        "PUT",
        "/api/work-orders/WO-TEST-3",
        {
          action: "complete",
        }
      );

      assertResponseStatus(
        completeResponse,
        200,
        "Work Order COMPLETE failed"
      );

      const invalidTransition = await request(
        app,
        "PUT",
        "/api/work-orders/WO-TEST-3",
        {
          action: "start",
        }
      );

      assertResponseStatus(
        invalidTransition,
        409,
        "Invalid state transition was not rejected"
      );
    }
  );
});