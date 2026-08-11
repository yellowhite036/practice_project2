const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const createApp = require("../src/app");

function createMockPool(options = {}) {
  const data = {
    materials: [{ material_id: "MAT-STEEL", name: "Steel", unit: "kg", stock: "1500.000" }],
    products: [{ product_id: "PRD-STEEL-TUBE", name: "Steel Tube", cycle_minutes: 20, stock: 0, mold_id: "MOLD-TUBE" }],
    molds: [{ mold_id: "MOLD-TUBE", name: "Tube Mold", status: "Idle" }],
    bom: [{ bom_id: "BOM-0001", product_id: "PRD-STEEL-TUBE", material_id: "MAT-STEEL", amount_per_unit: "2.500" }],
    workOrders: [{ work_order_id: "WO-1", product_id: "PRD-STEEL-TUBE", quantity: 10, mold_id: "MOLD-TUBE", status: "Pending" }],
    logs: [{ log_id: 1, level: "INFO", message: "ok" }]
  };

  return {
    async query(sql, params = []) {
      if (options.failHealth && sql === "SELECT 1") throw new Error("database unavailable");
      if (options.failAll) throw new Error("database unavailable");

      if (sql === "SELECT 1") return { rows: [{ "?column?": 1 }] };
      if (sql.startsWith("SELECT * FROM materials WHERE")) {
        return { rows: data.materials.filter((row) => row.material_id === params[0]) };
      }
      if (sql.startsWith("SELECT * FROM materials")) return { rows: data.materials };
      if (sql.startsWith("INSERT INTO materials")) return { rows: [{ material_id: params[0], name: params[1], unit: params[2] }] };

      if (sql.startsWith("SELECT * FROM products WHERE")) {
        return { rows: data.products.filter((row) => row.product_id === params[0]) };
      }
      if (sql.startsWith("SELECT * FROM products")) return { rows: data.products };

      if (sql.startsWith("SELECT * FROM molds WHERE")) {
        return { rows: data.molds.filter((row) => row.mold_id === params[0]) };
      }
      if (sql.startsWith("SELECT * FROM molds")) return { rows: data.molds };

      if (sql.startsWith("SELECT product_id FROM products")) {
        return { rows: data.products.filter((row) => row.product_id === params[0]).map((row) => ({ product_id: row.product_id })) };
      }
      if (sql.startsWith("SELECT material_id FROM materials")) {
        return { rows: data.materials.filter((row) => row.material_id === params[0]).map((row) => ({ material_id: row.material_id })) };
      }
      if (sql.startsWith("SELECT bom_id FROM bom_table")) return { rows: [] };
      if (sql.startsWith("SELECT * FROM bom_table WHERE product_id")) {
        return { rows: data.bom.filter((row) => row.product_id === params[0]) };
      }
      if (sql.startsWith("SELECT * FROM bom_table")) return { rows: data.bom };

      if (sql.startsWith("SELECT * FROM work_orders WHERE")) {
        return { rows: data.workOrders.filter((row) => row.work_order_id === params[0]) };
      }
      if (sql.startsWith("SELECT * FROM work_orders")) return { rows: data.workOrders };

      if (sql.startsWith("SELECT * FROM system_logs")) return { rows: data.logs };

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

test("GET list endpoints return arrays", async () => {
  const app = createApp({ pool: createMockPool() });
  for (const path of ["/api/materials", "/api/products", "/api/molds", "/api/bom", "/api/work-orders", "/api/logs"]) {
    const res = await request(app, "GET", path);
    assert.equal(res.statusCode, 200, path);
    assert.equal(Array.isArray(res.body), true, path);
  }
});

test("GET unknown id returns 404", async () => {
  const app = createApp({ pool: createMockPool() });
  const res = await request(app, "GET", "/api/materials/UNKNOWN");
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: "Material not found" });
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

test("health database failure returns 503 without crashing", async () => {
  const app = createApp({ pool: createMockPool({ failHealth: true }) });
  const res = await request(app, "GET", "/api/health");
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.status, "error");
  assert.equal(res.body.database, "error");
});
