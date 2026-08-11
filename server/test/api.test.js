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

  return {
    async query(sql, params = []) {
      if (options.failHealth && sql === "SELECT 1") throw new Error("database unavailable");
      if (options.failAll) throw new Error("database unavailable");
      if (options.pgErrorCode) throw pgError(options.pgErrorCode);

      if (sql === "SELECT 1") return { rows: [{ "?column?": 1 }] };

      if (sql.includes("FROM materials WHERE material_id = $1")) {
        return { rows: data.materials.filter((row) => row.material_id === params[0]) };
      }
      if (sql.includes("FROM materials ORDER BY")) return { rows: data.materials };
      if (sql.includes("INSERT INTO materials")) return { rows: [{ ...data.materials[0], material_id: params[0], name: params[1], unit: params[2] }] };
      if (sql.includes("UPDATE materials")) return { rows: params[6] === "UNKNOWN" ? [] : [{ ...data.materials[0], name: params[0], unit: params[1], stock: params[2] }] };
      if (sql.includes("DELETE FROM materials")) return { rows: params[0] === "UNKNOWN" ? [] : [{ material_id: params[0] }] };

      if (sql.includes("FROM products WHERE product_id = $1")) {
        return { rows: data.products.filter((row) => row.product_id === params[0]) };
      }
      if (sql.includes("FROM products ORDER BY")) return { rows: data.products };
      if (sql.includes("SELECT product_id FROM products")) {
        return { rows: data.products.filter((row) => row.product_id === params[0]).map((row) => ({ product_id: row.product_id })) };
      }

      if (sql.includes("FROM molds WHERE mold_id = $1")) {
        return { rows: data.molds.filter((row) => row.mold_id === params[0]) };
      }
      if (sql.includes("FROM molds ORDER BY")) return { rows: data.molds };
      if (sql.includes("DELETE FROM molds")) return { rows: params[0] === "UNKNOWN" ? [] : [{ mold_id: params[0] }] };

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
    location: "A-02-02"
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.body.name, "Steel Updated");

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
