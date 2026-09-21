const http = require("node:http");
const { Pool } = require("pg");
const jwt = require("jsonwebtoken");
const { migrateTestDatabase } = require("./migrateTestDatabase");

const config = {
  host: process.env.TEST_DB_HOST || "localhost",
  port: process.env.TEST_DB_PORT || "5432",
  database: process.env.TEST_DB_NAME || "practice_project2_test",
  user: process.env.TEST_DB_USER || "postgres",
  password: process.env.TEST_DB_PASSWORD || "postgres"
};
const secret = process.env.JWT_SECRET || "test_secret_integration";

function token(userId = "AOV-ADMIN") {
  return jwt.sign({ user_id: userId, role: "admin" }, secret);
}

function request(app, method, path, body, authToken = token()) {
  const server = http.createServer(app);
  return new Promise((resolve, reject) => server.listen(0, "127.0.0.1", () => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const req = http.request({ hostname: "127.0.0.1", port: server.address().port, method, path,
      headers: { Authorization: `Bearer ${authToken}`, ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}) } }, res => {
      let text = "";
      res.on("data", chunk => { text += chunk; });
      res.on("end", () => { server.close(); resolve({ statusCode: res.statusCode, body: text ? JSON.parse(text) : null }); });
    });
    req.on("error", error => { server.close(); reject(error); });
    if (payload) req.write(payload);
    req.end();
  }));
}

async function createDatabase() {
  const pool = new Pool(config);
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await migrateTestDatabase(pool);
  return pool;
}

async function seedBase(pool, { userId = "AOV-ADMIN", productId = "AOV-PRODUCT", moldId = "AOV-MOLD", materialId = "AOV-MATERIAL" } = {}) {
  await pool.query(
    `INSERT INTO users(user_id, name, role) VALUES ($1, 'AOV Admin', 'admin');`,
    [userId]
  );
  await pool.query(
    `INSERT INTO materials(material_id, name, unit, stock, capacity, safety_stock) VALUES ($1, 'AOV Material', 'pcs', 1000, 1000, 0);`,
    [materialId]
  );
  await pool.query(
    `INSERT INTO molds(mold_id, name, status) VALUES ($1, 'AOV Mold', 'Idle');`,
    [moldId]
  );
  await pool.query(
    `INSERT INTO products(product_id, name, cycle_minutes, mold_id, stock) VALUES ($1, 'AOV Product', 10, $2, 0);`,
    [productId, moldId]
  );
  await pool.query(
    `INSERT INTO bom_table(bom_id, product_id, material_id, amount_per_unit) VALUES ($1, $2, $3, $4);`,
    ['AOV-BOM', productId, materialId, 2]
  );
  return { userId, productId, moldId, materialId };
}

const dagPayload = productId => ({
  product_id: productId, name: "AOV DAG", description: "integration test", version: 1,
  nodes: [
    { node_key: "A", name: "Prepare", duration: 10 }, { node_key: "B", name: "Mold", duration: 30 },
    { node_key: "C", name: "Metal", duration: 20 }, { node_key: "D", name: "Assemble", duration: 15 },
    { node_key: "E", name: "Inspect", duration: 10 }
  ],
  edges: [{ from: "A", to: "B" }, { from: "A", to: "C" }, { from: "B", to: "D" }, { from: "C", to: "D" }, { from: "D", to: "E" }]
});

module.exports = { config, secret, token, request, createDatabase, seedBase, dagPayload };
