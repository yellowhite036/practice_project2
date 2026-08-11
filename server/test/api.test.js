const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

process.env.DATABASE_HOST = "localhost";
process.env.DATABASE_PORT = "5432";
process.env.DATABASE_NAME = "test_db";
process.env.DATABASE_USER = "test_user";
process.env.DATABASE_PASSWORD = "test_password";

const createApp = require("../src/app");

function pgError(code) {
  const error = new Error("mock database error");
  error.code = code;
  return error;
}

function createMockPool(options = {}) {
  const data = {
    materials: [{ material_id: "MAT-STEEL", name: "Steel", unit: "kg", stock: "1500.000", capacity: "2000.000", safety_stock: "300.000", location: "A-01-01", version: 1 }],
    products: [{ product_id: "PRD-STEEL-TUBE", name: "Steel Tube", cycle_minutes: 20, stock: 0, mold_id: "MOLD-TUBE", version: 1 }],
    molds: [{ mold_id: "MOLD-TUBE", name: "Tube Mold", status: "Idle", line: null, eta: null, product_id: null, version: 1 }],
    bom: [{ bom_id: "BOM-0001", product_id: "PRD-STEEL-TUBE", material_id: "MAT-STEEL", amount_per_unit: "2.500", version: 1 }],
    workOrders: [{ work_order_id: "WO-1", product_id: "PRD-STEEL-TUBE", quantity: 10, line: "L1", mold_id: "MOLD-TUBE", status: "Pending", creator_user_id: null, creator_name: "Operator" }],
    logs: [{ log_id: 1, level: "INFO", message: "ok", work_order_id: null, created_by_user_id: null, created_at: "2026-08-11T00:00:00.000Z" }]
  };

  const pool = {
    async query(sql, params = []) {
      if (options.failHealth && sql === "SELECT 1") throw new Error("database unavailable");
      if (options.failAll) throw new Error("database unavailable");
      if (options.pgErrorCode) {
        const err = new Error("mock database error");
        err.code = options.pgErrorCode;
        throw err;
      }

      if (sql === "SELECT 1") return { rows: [{ "?column?": 1 }] };

      if (sql.includes("FROM materials WHERE material_id = $1")) {
        return { rows: data.materials.filter((row) => row.material_id === params[0]) };
      }
      if (sql.includes("FROM materials ORDER BY")) return { rows: data.materials };
      if (sql.includes("INSERT INTO materials")) return { rows: [{ ...data.materials[0], material_id: params[0], name: params[1], unit: params[2] }] };
      if (sql.includes("UPDATE materials")) {
        const id = params[6];
        const version = params[7];
        const item = data.materials.find((m) => m.material_id === id);
        if (!item || item.version !== version) return { rows: [] };
        return { rows: [{ ...item, name: params[0], unit: params[1], stock: params[2], version: version + 1 }] };
      }
      if (sql.includes("DELETE FROM materials")) return { rows: params[0] === "UNKNOWN" ? [] : [{ material_id: params[0] }] };

      if (sql.includes("FROM products WHERE product_id = $1")) {
        return { rows: data.products.filter((row) => row.product_id === params[0]) };
      }
      if (sql.includes("FROM products ORDER BY")) return { rows: data.products };
      if (sql.includes("SELECT product_id FROM products")) {
        return { rows: data.products.filter((row) => row.product_id === params[0]).map((row) => ({ product_id: row.product_id })) };
      }
      if (sql.includes("UPDATE products")) {
        const id = params[4];
        const version = params[5];
        const item = data.products.find((p) => p.product_id === id);
        if (!item || item.version !== version) return { rows: [] };
        return { rows: [{ ...item, name: params[0], cycle_minutes: params[1], mold_id: params[2], stock: params[3], version: version + 1 }] };
      }

      if (sql.includes("FROM molds WHERE mold_id = $1")) {
        return { rows: data.molds.filter((row) => row.mold_id === params[0]) };
      }
      if (sql.includes("FROM molds ORDER BY")) return { rows: data.molds };
      if (sql.includes("DELETE FROM molds")) return { rows: params[0] === "UNKNOWN" ? [] : [{ mold_id: params[0] }] };
      if (sql.includes("UPDATE molds\n       SET name")) {
        const id = params[5];
        const version = params[6];
        const item = data.molds.find((m) => m.mold_id === id);
        if (!item || item.version !== version) return { rows: [] };
        return { rows: [{ ...item, name: params[0], status: params[1], line: params[2], eta: params[3], product_id: params[4], version: version + 1 }] };
      }
      if (sql.includes("UPDATE molds SET status")) {
        if (params.length === 0) {
          // Literal SQL: UPDATE molds SET status = 'In_Use' WHERE mold_id = 'MOLD-TUBE'
          const match = sql.match(/WHERE mold_id = '([^']+)'/);
          const statusMatch = sql.match(/status = '([^']+)'/);
          if (match && statusMatch) {
            const mold = data.molds.find((m) => m.mold_id === match[1]);
            if (mold) mold.status = statusMatch[1];
          }
        } else {
          // Parameterized from transaction: UPDATE molds SET status = 'In_Use', product_id = $1 WHERE mold_id = $2
          const mold = data.molds.find((m) => m.mold_id === params[params.length - 1]);
          if (mold) mold.status = "In_Use";
        }
        return { rows: [] };
      }

      if (sql.includes("SELECT material_id FROM materials")) {
        return { rows: data.materials.filter((row) => row.material_id === params[0]).map((row) => ({ material_id: row.material_id })) };
      }
      if (sql.includes("FROM bom_table WHERE product_id = $1 AND material_id = $2")) {
        if (options.duplicateBom) return { rows: [{ bom_id: "BOM-EXISTING" }] };
        return { rows: [] };
      }
      if (sql.includes("FROM bom_table WHERE product_id = $1 ORDER BY")) {
        return { rows: data.bom.filter((row) => row.product_id === params[0]) };
      }
      if (sql.includes("FROM bom_table WHERE bom_id = $1")) {
        return { rows: data.bom.filter((row) => row.bom_id === params[0]) };
      }
      if (sql.includes("FROM bom_table ORDER BY")) return { rows: data.bom };
      if (sql.includes("UPDATE bom_table")) {
        const id = params[3];
        const version = params[4];
        const item = data.bom.find((b) => b.bom_id === id);
        if (!item || item.version !== version) return { rows: [] };
        return { rows: [{ ...item, product_id: params[0], material_id: params[1], amount_per_unit: params[2], version: version + 1 }] };
      }
      if (sql.includes("DELETE FROM bom_table")) return { rows: params[0] === "BOM-404" ? [] : [{ bom_id: params[0] }] };

      if (sql.includes("FROM work_orders WHERE work_order_id = $1")) {
        return { rows: data.workOrders.filter((row) => row.work_order_id === params[0]) };
      }
      if (sql.includes("FROM work_orders ORDER BY")) return { rows: data.workOrders };

      if (sql.includes("FROM system_logs WHERE log_id = $1")) {
        return { rows: data.logs.filter((row) => String(row.log_id) === String(params[0])) };
      }
      if (sql.includes("FROM system_logs ORDER BY")) return { rows: data.logs };

      return { rows: [] };
    }
  };

  pool.connect = async function() {
    let inTransaction = false;
    return {
      query: async function(sql, params = []) {
        if (sql === "BEGIN") { inTransaction = true; return { rows: [] }; }
        if (sql === "COMMIT" || sql === "ROLLBACK") { inTransaction = false; return { rows: [] }; }

        if (sql.includes("SELECT product_id FROM products WHERE product_id = $1")) {
          return { rows: data.products.filter(p => p.product_id === params[0]) };
        }

        if (sql.includes("SELECT material_id, amount_per_unit FROM bom_table WHERE product_id = $1 ORDER BY material_id")) {
          return { rows: data.bom.filter(b => b.product_id === params[0]) };
        }

        if (sql.includes("SELECT material_id, stock FROM materials WHERE material_id = ANY($1) ORDER BY material_id FOR UPDATE")) {
          return { rows: data.materials.filter(m => params[0].includes(m.material_id)) };
        }

        if (sql.includes("UPDATE materials SET stock = stock - $1, updated_at = now() WHERE material_id = $2")) {
          if (options.failUpdateMaterial) throw new Error("failUpdateMaterial");
          const m = data.materials.find(x => x.material_id === params[1]);
          if (m) m.stock = Number(m.stock) - params[0];
          return { rows: [m] };
        }

        if (sql.includes("INSERT INTO inventory_transactions")) {
          if (options.failInventoryTransaction) throw new Error("failInventoryTransaction");
          return { rows: [{}] };
        }

        if (sql.includes("SELECT status FROM molds WHERE mold_id = $1 FOR UPDATE")) {
          return { rows: data.molds.filter(m => m.mold_id === params[0]) };
        }

        if (sql.includes("UPDATE products SET stock = stock + $1")) {
          if (options.failUpdateProduct) throw new Error("failUpdateProduct");
          const p = data.products.find(x => x.product_id === params[1]);
          if (p) p.stock += params[0];
          return { rows: [p] };
        }

        if (sql.includes("UPDATE molds SET status = 'In_Use'")) {
          if (options.failUpdateMold) throw new Error("failUpdateMold");
          const m = data.molds.find(x => x.mold_id === params[0]);
          if (m) m.status = 'In_Use';
          return { rows: [m] };
        }

        if (sql.includes("INSERT INTO work_orders")) {
          if (options.failWorkOrder) throw new Error("failWorkOrder");
          return { rows: [{ work_order_id: params[0], product_id: params[1], quantity: params[2], line: params[3], mold_id: params[4], status: params[5], creator_user_id: params[6], creator_name: params[7] }] };
        }

        if (sql.includes("INSERT INTO system_logs")) {
          if (options.failSystemLog) throw new Error("failSystemLog");
          return { rows: [{}] };
        }

        return pool.query(sql, params);
      },
      release: function() {}
    };
  };

  pool.withTransaction = async function(callback) {
    const client = await this.connect();
    try {
      await client.query("BEGIN");
      if (options.onBegin) options.onBegin();
      const result = await callback(client);
      await client.query("COMMIT");
      if (options.onCommit) options.onCommit();
      return result;
    } catch (err) {
      await client.query("ROLLBACK");
      if (options.onRollback) options.onRollback();
      throw err;
    } finally {
      client.release();
    }
  };

  return pool;
}

function request(app, method, path, body) {
  const server = http.createServer(app);

  return new Promise((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      const payload = body === undefined ? null : JSON.stringify(body);
      const req = http.request({
        hostname: "127.0.0.1",
        port,
        method,
        path,
        headers: payload
          ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) }
          : undefined
      }, (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          server.close();
          resolve({
            statusCode: res.statusCode,
            body: raw ? JSON.parse(raw) : null
          });
        });
      });

      req.on("error", (error) => {
        server.close();
        reject(error);
      });

      if (payload) req.write(payload);
      req.end();
    });
  });
}

test("GET /api/health returns API and database health", async () => {
  const app = createApp({ pool: createMockPool() });
  const res = await request(app, "GET", "/api/health");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { status: "ok", database: "ok" });
});

test("health database failure returns 503 without crashing", async () => {
  const app = createApp({ pool: createMockPool({ failHealth: true }) });
  const res = await request(app, "GET", "/api/health");
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.status, "error");
  assert.equal(res.body.database, "error");
});

test("GET list endpoints return arrays", async () => {
  const app = createApp({ pool: createMockPool() });
  for (const path of ["/api/materials", "/api/products", "/api/molds", "/api/bom", "/api/work-orders", "/api/logs"]) {
    const res = await request(app, "GET", path);
    assert.equal(res.statusCode, 200, path);
    assert.equal(Array.isArray(res.body), true, path);
  }
});

test("materials CRUD endpoints return expected status codes", async () => {
  const app = createApp({ pool: createMockPool() });

  const getOne = await request(app, "GET", "/api/materials/MAT-STEEL");
  assert.equal(getOne.statusCode, 200);
  assert.equal(getOne.body.material_id, "MAT-STEEL");

  const created = await request(app, "POST", "/api/materials", {
    material_id: "MAT-COPPER",
    name: "Copper",
    unit: "kg",
    stock: 10,
    capacity: 100,
    safety_stock: 5,
    location: "A-02-01"
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.body.material_id, "MAT-COPPER");

  const updated = await request(app, "PUT", "/api/materials/MAT-STEEL", {
    name: "Steel Updated",
    unit: "kg",
    stock: 11,
    capacity: 100,
    safety_stock: 5,
    location: "A-02-02",
    version: 1
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.body.name, "Steel Updated");
  assert.equal(updated.body.version, 2);

  const deleted = await request(app, "DELETE", "/api/materials/MAT-STEEL");
  assert.equal(deleted.statusCode, 200);
  assert.deepEqual(deleted.body, { deleted: true, id: "MAT-STEEL" });
});

test("detail query endpoints return rows", async () => {
  const app = createApp({ pool: createMockPool() });
  const cases = [
    ["/api/products/PRD-STEEL-TUBE", "product_id", "PRD-STEEL-TUBE"],
    ["/api/molds/MOLD-TUBE", "mold_id", "MOLD-TUBE"],
    ["/api/bom/BOM-0001", "bom_id", "BOM-0001"],
    ["/api/bom/product/PRD-STEEL-TUBE", null, null],
    ["/api/logs/1", "log_id", 1]
  ];

  for (const [path, key, value] of cases) {
    const res = await request(app, "GET", path);
    assert.equal(res.statusCode, 200, path);
    if (key) assert.equal(res.body[key], value, path);
    else assert.equal(Array.isArray(res.body), true, path);
  }
});

test("mold delete endpoint returns JSON", async () => {
  const app = createApp({ pool: createMockPool() });
  const res = await request(app, "DELETE", "/api/molds/MOLD-TUBE");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { deleted: true, id: "MOLD-TUBE" });
});

test("unknown ids return 404", async () => {
  const app = createApp({ pool: createMockPool() });
  const cases = [
    ["/api/materials/UNKNOWN", "Material not found"],
    ["/api/products/UNKNOWN", "Product not found"],
    ["/api/molds/UNKNOWN", "Mold not found"],
    ["/api/bom/BOM-404", "BOM not found"],
    ["/api/work-orders/UNKNOWN", "Work order not found"],
    ["/api/logs/404", "Log not found"]
  ];

  for (const [path, message] of cases) {
    const res = await request(app, "GET", path);
    assert.equal(res.statusCode, 404, path);
    assert.deepEqual(res.body, { error: message }, path);
  }
});

test("invalid input returns 400", async () => {
  const app = createApp({ pool: createMockPool() });
  const res = await request(app, "POST", "/api/materials", {
    material_id: "MAT-BAD",
    name: "Bad",
    unit: "kg",
    stock: -1
  });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "stock must be greater than or equal to 0" });
});

test("duplicate BOM returns 409", async () => {
  const app = createApp({ pool: createMockPool({ duplicateBom: true }) });
  const res = await request(app, "POST", "/api/bom", {
    bom_id: "BOM-NEW",
    product_id: "PRD-STEEL-TUBE",
    material_id: "MAT-STEEL",
    amount_per_unit: 1
  });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: "product_id and material_id already exist in BOM" });
});

test("PostgreSQL unique violation 23505 returns 409", async () => {
  const app = createApp({ pool: createMockPool({ pgErrorCode: "23505" }) });
  const res = await request(app, "GET", "/api/materials");
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: "Database constraint conflict" });
});

test("PostgreSQL foreign key violation 23503 returns 409", async () => {
  const app = createApp({ pool: createMockPool({ pgErrorCode: "23503" }) });
  const res = await request(app, "GET", "/api/materials");
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: "Database constraint conflict" });
});

test("PostgreSQL check violation 23514 returns 409", async () => {
  const app = createApp({ pool: createMockPool({ pgErrorCode: "23514" }) });
  const res = await request(app, "GET", "/api/materials");
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: "Database constraint conflict" });
});

test("PostgreSQL not-null violation 23502 returns 400", async () => {
  const app = createApp({ pool: createMockPool({ pgErrorCode: "23502" }) });
  const res = await request(app, "GET", "/api/materials");
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: "Required database field is missing" });
});

test("Work Order creation uses transaction and succeeds", async () => {
  let beginCount = 0, commitCount = 0, rollbackCount = 0;
  const poolOpts = {
    onBegin: () => beginCount++,
    onCommit: () => commitCount++,
    onRollback: () => rollbackCount++
  };
  const app = createApp({ pool: createMockPool(poolOpts) });
  const res = await request(app, "POST", "/api/work-orders", {
    work_order_id: "WO-NEW",
    product_id: "PRD-STEEL-TUBE",
    quantity: 100,
    line: "L1",
    mold_id: "MOLD-TUBE"
  });

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.work_order_id, "WO-NEW");
  assert.equal(beginCount, 1);
  assert.equal(commitCount, 1);
  assert.equal(rollbackCount, 0);
});

test("Work Order creation fails and rolls back on insufficient material stock", async () => {
  let rollbackCount = 0;
  const app = createApp({ pool: createMockPool({ onRollback: () => rollbackCount++ }) });

  // quantity 1000 * 2.5 = 2500, but stock is 1500
  const res = await request(app, "POST", "/api/work-orders", {
    work_order_id: "WO-NEW",
    product_id: "PRD-STEEL-TUBE",
    quantity: 1000,
    line: "L1",
    mold_id: "MOLD-TUBE"
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "Insufficient stock for material MAT-STEEL");
  assert.equal(rollbackCount, 1);
});

test("Work Order creation fails and rolls back when mold is in use", async () => {
  let rollbackCount = 0;
  const pool = createMockPool({ onRollback: () => rollbackCount++ });
  // force mold to in use
  await pool.query("UPDATE molds SET status = 'In_Use' WHERE mold_id = 'MOLD-TUBE'");

  const app = createApp({ pool });

  const res = await request(app, "POST", "/api/work-orders", {
    work_order_id: "WO-NEW",
    product_id: "PRD-STEEL-TUBE",
    quantity: 10,
    line: "L1",
    mold_id: "MOLD-TUBE"
  });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "Mold is currently in use");
  assert.equal(rollbackCount, 1);
});

test("Work Order creation rolls back if inventory transaction fails", async () => {
  let rollbackCount = 0;
  const app = createApp({ pool: createMockPool({ failInventoryTransaction: true, onRollback: () => rollbackCount++ }) });

  const res = await request(app, "POST", "/api/work-orders", {
    work_order_id: "WO-NEW",
    product_id: "PRD-STEEL-TUBE",
    quantity: 10,
    line: "L1",
    mold_id: "MOLD-TUBE"
  });

  assert.equal(res.statusCode, 500);
  assert.equal(rollbackCount, 1);
});

test("Work Order creation rolls back if system log fails", async () => {
  let rollbackCount = 0;
  const app = createApp({ pool: createMockPool({ failSystemLog: true, onRollback: () => rollbackCount++ }) });

  const res = await request(app, "POST", "/api/work-orders", {
    work_order_id: "WO-NEW",
    product_id: "PRD-STEEL-TUBE",
    quantity: 10,
    line: "L1",
    mold_id: "MOLD-TUBE"
  });

  assert.equal(res.statusCode, 500);
  assert.equal(rollbackCount, 1);
});

test('optimistic lock returns 400 when version is missing', async () => {
  const app = createApp({ pool: createMockPool() });
  const res = await request(app, 'PUT', '/api/materials/MAT-STEEL', {
    name: 'Steel Updated',
    unit: 'kg',
    stock: 11
  });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'version is required' });
});

test('optimistic lock returns 409 when version is incorrect', async () => {
  const app = createApp({ pool: createMockPool() });
  const res = await request(app, 'PUT', '/api/materials/MAT-STEEL', {
    name: 'Steel Updated',
    unit: 'kg',
    stock: 11,
    version: 999
  });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.body, { error: 'Optimistic lock conflict or resource not found' });
});
