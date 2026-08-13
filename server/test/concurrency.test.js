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
    user_id: "ADMIN-CONCURRENT",
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
      await tempPool.end().catch(() => {});
    }
  }
}

async function resetDatabase() {
  await pool.query(`
    DROP SCHEMA public CASCADE;
    CREATE SCHEMA public;
  `);

  await runMigration();
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

async function seedAdmin() {
  await pool.query(`
    INSERT INTO users (user_id, name, role)
    VALUES ('ADMIN-CONCURRENT', 'Concurrent Admin', 'admin');
  `);
}

async function seedSharedMoldContention() {
  await cleanData();
  await seedAdmin();

  await pool.query(`
    INSERT INTO materials (
      material_id,
      name,
      unit,
      stock,
      capacity,
      safety_stock
    )
    VALUES (
      'MAT-CONCURRENT-MOLD',
      'Concurrent Mold Material',
      'pcs',
      20,
      100,
      0
    );

    INSERT INTO molds (mold_id, name, status, line)
    VALUES ('MOLD-CONCURRENT-ONE', 'Concurrent Single Mold', 'Idle', 'L1');

    INSERT INTO products (
      product_id,
      name,
      cycle_minutes,
      mold_id,
      stock
    )
    VALUES (
      'PRD-CONCURRENT-MOLD',
      'Concurrent Mold Product',
      10,
      'MOLD-CONCURRENT-ONE',
      0
    );

    INSERT INTO bom_table (
      bom_id,
      product_id,
      material_id,
      amount_per_unit
    )
    VALUES (
      'BOM-CONCURRENT-MOLD',
      'PRD-CONCURRENT-MOLD',
      'MAT-CONCURRENT-MOLD',
      10
    );
  `);
}

async function seedSharedMaterialContention() {
  await cleanData();
  await seedAdmin();

  await pool.query(`
    INSERT INTO materials (
      material_id,
      name,
      unit,
      stock,
      capacity,
      safety_stock
    )
    VALUES (
      'MAT-CONCURRENT-STOCK',
      'Concurrent Stock Material',
      'pcs',
      20,
      100,
      0
    );

    INSERT INTO molds (mold_id, name, status, line)
    VALUES
      ('MOLD-CONCURRENT-A', 'Concurrent Mold A', 'Idle', 'L1'),
      ('MOLD-CONCURRENT-B', 'Concurrent Mold B', 'Idle', 'L2'),
      ('MOLD-CONCURRENT-C', 'Concurrent Mold C', 'Idle', 'L3');

    INSERT INTO products (
      product_id,
      name,
      cycle_minutes,
      mold_id,
      stock
    )
    VALUES
      ('PRD-CONCURRENT-A', 'Concurrent Product A', 10, 'MOLD-CONCURRENT-A', 0),
      ('PRD-CONCURRENT-B', 'Concurrent Product B', 10, 'MOLD-CONCURRENT-B', 0),
      ('PRD-CONCURRENT-C', 'Concurrent Product C', 10, 'MOLD-CONCURRENT-C', 0);

    INSERT INTO bom_table (
      bom_id,
      product_id,
      material_id,
      amount_per_unit
    )
    VALUES
      ('BOM-CONCURRENT-A', 'PRD-CONCURRENT-A', 'MAT-CONCURRENT-STOCK', 10),
      ('BOM-CONCURRENT-B', 'PRD-CONCURRENT-B', 'MAT-CONCURRENT-STOCK', 10),
      ('BOM-CONCURRENT-C', 'PRD-CONCURRENT-C', 'MAT-CONCURRENT-STOCK', 10);
  `);
}

async function seedSingleWorkOrderLifecycle() {
  await cleanData();
  await seedAdmin();

  await pool.query(`
    INSERT INTO materials (
      material_id,
      name,
      unit,
      stock,
      capacity,
      safety_stock
    )
    VALUES (
      'MAT-CONCURRENT-LIFE',
      'Concurrent Lifecycle Material',
      'pcs',
      50,
      100,
      0
    );

    INSERT INTO molds (mold_id, name, status, line)
    VALUES ('MOLD-CONCURRENT-LIFE', 'Concurrent Lifecycle Mold', 'Idle', 'L1');

    INSERT INTO products (
      product_id,
      name,
      cycle_minutes,
      mold_id,
      stock
    )
    VALUES (
      'PRD-CONCURRENT-LIFE',
      'Concurrent Lifecycle Product',
      10,
      'MOLD-CONCURRENT-LIFE',
      0
    );

    INSERT INTO bom_table (
      bom_id,
      product_id,
      material_id,
      amount_per_unit
    )
    VALUES (
      'BOM-CONCURRENT-LIFE',
      'PRD-CONCURRENT-LIFE',
      'MAT-CONCURRENT-LIFE',
      5
    );
  `);
}

async function createWorkOrder(workerId, payload) {
  try {
    const response = await request(app, "POST", "/api/work-orders", {
      ...payload,
      creator_user_id: "ADMIN-CONCURRENT",
      creator_name: `Worker ${workerId}`,
    });

    return {
      workerId,
      operation: "create-work-order",
      request: payload,
      statusCode: response.statusCode,
      body: response.body,
    };
  } catch (error) {
    return {
      workerId,
      operation: "create-work-order",
      request: payload,
      error: error.message,
    };
  }
}

async function updateWorkOrder(workerId, workOrderId, action) {
  try {
    const response = await request(
      app,
      "PUT",
      `/api/work-orders/${workOrderId}`,
      { action }
    );

    return {
      workerId,
      operation: `${action}-work-order`,
      workOrderId,
      statusCode: response.statusCode,
      body: response.body,
    };
  } catch (error) {
    return {
      workerId,
      operation: `${action}-work-order`,
      workOrderId,
      error: error.message,
    };
  }
}

async function updateMaterialWithVersion(workerId, stock) {
  try {
    const response = await request(
      app,
      "PUT",
      "/api/materials/MAT-LOCK",
      {
        name: "Optimistic Lock Material",
        unit: "pcs",
        stock,
        capacity: 100,
        safety_stock: 0,
        version: 1,
      }
    );

    return {
      workerId,
      operation: "update-material-version-1",
      stock,
      statusCode: response.statusCode,
      body: response.body,
    };
  } catch (error) {
    return {
      workerId,
      operation: "update-material-version-1",
      stock,
      error: error.message,
    };
  }
}

function assertWorkerSummary(condition, message, workers, state = {}) {
  if (!condition) {
    assert.fail(
      `${message}\nWorkers: ${JSON.stringify(workers, null, 2)}\n` +
        `State: ${JSON.stringify(state, null, 2)}`
    );
  }
}

function countByStatus(workers, statusCode) {
  return workers.filter((worker) => worker.statusCode === statusCode).length;
}

test("PostgreSQL 3 Worker Concurrency Tests", async (t) => {
  const available = await checkDatabaseAvailable();

  if (!available) {
    console.log(
      "PostgreSQL concurrency tests: NOT RUN - PostgreSQL environment unavailable"
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
    await resetDatabase();
  } catch (error) {
    console.error("Concurrency migration failed:", error);
    throw error;
  }

  app = createApp({ pool });

  t.after(async () => {
    await pool.end();
  });

  await t.test(
    "1. three workers competing for the same mold create exactly one work order",
    async () => {
      await seedSharedMoldContention();

      const workers = await Promise.all([
        createWorkOrder("worker-1", {
          work_order_id: "WO-CONCURRENT-MOLD-1",
          product_id: "PRD-CONCURRENT-MOLD",
          quantity: 1,
          line: "L1",
          mold_id: "MOLD-CONCURRENT-ONE",
        }),
        createWorkOrder("worker-2", {
          work_order_id: "WO-CONCURRENT-MOLD-2",
          product_id: "PRD-CONCURRENT-MOLD",
          quantity: 1,
          line: "L1",
          mold_id: "MOLD-CONCURRENT-ONE",
        }),
        createWorkOrder("worker-3", {
          work_order_id: "WO-CONCURRENT-MOLD-3",
          product_id: "PRD-CONCURRENT-MOLD",
          quantity: 1,
          line: "L1",
          mold_id: "MOLD-CONCURRENT-ONE",
        }),
      ]);

      const state = await readSummaryState({
        materialId: "MAT-CONCURRENT-MOLD",
        productId: "PRD-CONCURRENT-MOLD",
        moldId: "MOLD-CONCURRENT-ONE",
      });

      assertWorkerSummary(
        countByStatus(workers, 201) === 1,
        "Expected exactly one worker to create the work order",
        workers,
        state
      );

      assertWorkerSummary(
        countByStatus(workers, 409) === 2,
        "Expected two workers to fail on mold row-level locking/status",
        workers,
        state
      );

      assert.equal(state.materialStock, 10);
      assert.equal(state.productStock, 0);
      assert.equal(state.moldStatus, "In_Use");
      assert.equal(state.workOrderCount, 1);
      assert.equal(state.pendingCount, 1);
      assert.equal(state.consumeCount, 1);
      assert.equal(state.consumeQuantity, -10);
    }
  );

  await t.test(
    "2. three workers sharing one material cannot oversell stock",
    async () => {
      await seedSharedMaterialContention();

      const workers = await Promise.all([
        createWorkOrder("worker-1", {
          work_order_id: "WO-CONCURRENT-STOCK-1",
          product_id: "PRD-CONCURRENT-A",
          quantity: 1,
          line: "L1",
          mold_id: "MOLD-CONCURRENT-A",
        }),
        createWorkOrder("worker-2", {
          work_order_id: "WO-CONCURRENT-STOCK-2",
          product_id: "PRD-CONCURRENT-B",
          quantity: 1,
          line: "L2",
          mold_id: "MOLD-CONCURRENT-B",
        }),
        createWorkOrder("worker-3", {
          work_order_id: "WO-CONCURRENT-STOCK-3",
          product_id: "PRD-CONCURRENT-C",
          quantity: 1,
          line: "L3",
          mold_id: "MOLD-CONCURRENT-C",
        }),
      ]);

      const state = await readSummaryState({
        materialId: "MAT-CONCURRENT-STOCK",
      });

      assertWorkerSummary(
        countByStatus(workers, 201) === 2,
        "Expected exactly two workers to consume available stock",
        workers,
        state
      );

      assertWorkerSummary(
        countByStatus(workers, 409) === 1,
        "Expected one worker to fail because material stock was exhausted",
        workers,
        state
      );

      assert.equal(state.materialStock, 0);
      assert.equal(state.workOrderCount, 2);
      assert.equal(state.pendingCount, 2);
      assert.equal(state.consumeCount, 2);
      assert.equal(state.consumeQuantity, -20);
      assert.equal(state.busyMoldCount, 2);
      assert.equal(state.idleMoldCount, 1);
    }
  );

  await t.test(
    "3. three workers completing the same work order produce stock only once",
    async () => {
      await seedSingleWorkOrderLifecycle();

      const createResult = await createWorkOrder("setup-worker", {
        work_order_id: "WO-CONCURRENT-COMPLETE",
        product_id: "PRD-CONCURRENT-LIFE",
        quantity: 3,
        line: "L1",
        mold_id: "MOLD-CONCURRENT-LIFE",
      });

      assertWorkerSummary(
        createResult.statusCode === 201,
        "Setup worker could not create the lifecycle work order",
        [createResult]
      );

      const workers = await Promise.all([
        updateWorkOrder("worker-1", "WO-CONCURRENT-COMPLETE", "complete"),
        updateWorkOrder("worker-2", "WO-CONCURRENT-COMPLETE", "complete"),
        updateWorkOrder("worker-3", "WO-CONCURRENT-COMPLETE", "complete"),
      ]);

      const state = await readSummaryState({
        materialId: "MAT-CONCURRENT-LIFE",
        productId: "PRD-CONCURRENT-LIFE",
        moldId: "MOLD-CONCURRENT-LIFE",
      });

      assertWorkerSummary(
        countByStatus(workers, 200) === 1,
        "Expected exactly one worker to complete the work order",
        workers,
        state
      );

      assertWorkerSummary(
        countByStatus(workers, 409) === 2,
        "Expected two workers to be rejected after the row lock observed Completed",
        workers,
        state
      );

      assert.equal(state.materialStock, 35);
      assert.equal(state.productStock, 3);
      assert.equal(state.moldStatus, "Idle");
      assert.equal(state.completedCount, 1);
      assert.equal(state.produceCount, 1);
      assert.equal(state.produceQuantity, 3);
    }
  );

  await t.test(
    "4. three optimistic-lock workers updating one material allow exactly one version winner",
    async () => {
      await cleanData();
      await seedAdmin();

      await pool.query(`
        INSERT INTO materials (
          material_id,
          name,
          unit,
          stock,
          capacity,
          safety_stock
        )
        VALUES (
          'MAT-LOCK',
          'Optimistic Lock Material',
          'pcs',
          10,
          100,
          0
        );
      `);

      const workers = await Promise.all([
        updateMaterialWithVersion("worker-1", 11),
        updateMaterialWithVersion("worker-2", 12),
        updateMaterialWithVersion("worker-3", 13),
      ]);

      const { rows } = await pool.query(`
        SELECT stock, version
        FROM materials
        WHERE material_id = 'MAT-LOCK'
      `);

      const state = {
        materialStock: Number(rows[0].stock),
        version: rows[0].version,
      };

      assertWorkerSummary(
        countByStatus(workers, 200) === 1,
        "Expected exactly one optimistic-lock worker to update version 1",
        workers,
        state
      );

      assertWorkerSummary(
        countByStatus(workers, 409) === 2,
        "Expected two optimistic-lock workers to receive version conflicts",
        workers,
        state
      );

      const winner = workers.find((worker) => worker.statusCode === 200);

      assert.equal(state.version, 2);
      assert.equal(state.materialStock, winner.stock);
    }
  );
});

async function readSummaryState({
  materialId = null,
  productId = null,
  moldId = null,
} = {}) {
  const [
    material,
    product,
    mold,
    workOrders,
    consume,
    produce,
    molds,
  ] = await Promise.all([
    materialId
      ? pool.query(
          "SELECT stock FROM materials WHERE material_id = $1",
          [materialId]
        )
      : Promise.resolve({ rows: [] }),
    productId
      ? pool.query(
          "SELECT stock FROM products WHERE product_id = $1",
          [productId]
        )
      : Promise.resolve({ rows: [] }),
    moldId
      ? pool.query(
          "SELECT status FROM molds WHERE mold_id = $1",
          [moldId]
        )
      : Promise.resolve({ rows: [] }),
    pool.query(`
      SELECT status, COUNT(*)::int AS count
      FROM work_orders
      GROUP BY status
    `),
    pool.query(`
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(quantity), 0)::numeric AS quantity
      FROM inventory_transactions
      WHERE transaction_type = 'consume'
    `),
    pool.query(`
      SELECT
        COUNT(*)::int AS count,
        COALESCE(SUM(quantity), 0)::numeric AS quantity
      FROM inventory_transactions
      WHERE transaction_type = 'produce'
    `),
    pool.query(`
      SELECT status, COUNT(*)::int AS count
      FROM molds
      GROUP BY status
    `),
  ]);

  const statusCount = (rows, status) => {
    const row = rows.find((item) => item.status === status);
    return row ? Number(row.count) : 0;
  };

  return {
    materialStock: material.rows[0]
      ? Number(material.rows[0].stock)
      : null,
    productStock: product.rows[0]
      ? Number(product.rows[0].stock)
      : null,
    moldStatus: mold.rows[0] ? mold.rows[0].status : null,
    workOrderCount: workOrders.rows.reduce(
      (sum, row) => sum + Number(row.count),
      0
    ),
    pendingCount: statusCount(workOrders.rows, "Pending"),
    completedCount: statusCount(workOrders.rows, "Completed"),
    consumeCount: Number(consume.rows[0].count),
    consumeQuantity: Number(consume.rows[0].quantity),
    produceCount: Number(produce.rows[0].count),
    produceQuantity: Number(produce.rows[0].quantity),
    busyMoldCount: statusCount(molds.rows, "In_Use"),
    idleMoldCount: statusCount(molds.rows, "Idle"),
  };
}
