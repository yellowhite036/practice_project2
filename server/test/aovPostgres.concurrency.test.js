const test = require("node:test");
const assert = require("node:assert/strict");
const createApp = require("../src/app");
const { createDatabase, seedBase, request, token } = require("./utils/aovPostgresHarness");

async function publishedGraph(app, auth, productId, nodes, edges) {
  const created = await request(app, "POST", "/api/aov-graphs", { product_id: productId, name: "Concurrent DAG", version: 1, nodes, edges }, auth);
  assert.equal(created.statusCode, 201);
  const graphId = created.body.graph.id;
  assert.equal((await request(app, "POST", `/api/aov-graphs/${graphId}/publish`, undefined, auth)).statusCode, 200);
  return graphId;
}

async function createAovWorkOrder(app, auth, seed, graphId) {
  const response = await request(app, "POST", "/api/work-orders", { product_id: seed.productId, quantity: 4, line: "L1", mold_id: seed.moldId, aov_graph_id: graphId }, auth);
  assert.equal(response.statusCode, 201);
  return response.body.work_order_id;
}

test("PostgreSQL AOV concurrent completion produces once", async (t) => {
  let pool;
  try { pool = await createDatabase(); } catch (error) { t.skip(`PostgreSQL unavailable: ${error.message}`); return; }
  t.after(() => pool.end());
  const seed = await seedBase(pool);
  const app = createApp({ pool }); const auth = token(seed.userId);
  const graphId = await publishedGraph(app, auth, seed.productId, [{ node_key: "A", name: "Only task", duration: 1 }], []);
  const workOrderId = await createAovWorkOrder(app, auth, seed, graphId);
  const tasks = await request(app, "GET", `/api/work-orders/${workOrderId}/tasks`, undefined, auth);
  const taskId = tasks.body.tasks[0].id;
  assert.equal((await request(app, "POST", `/api/work-orders/${workOrderId}/tasks/${taskId}/start`, undefined, auth)).statusCode, 200);
  const results = await Promise.all([
    request(app, "POST", `/api/work-orders/${workOrderId}/tasks/${taskId}/complete`, undefined, auth),
    request(app, "POST", `/api/work-orders/${workOrderId}/tasks/${taskId}/complete`, undefined, auth)
  ]);
  assert.equal(results.filter(result => result.statusCode === 200).length, 1);
  assert.equal(results.filter(result => result.statusCode === 409).length, 1);
  const state = await pool.query(
    `SELECT t.status AS task_status, wo.status AS work_order_status, p.stock,
            (SELECT count(*)::int FROM inventory_transactions it WHERE it.work_order_id = wo.work_order_id AND it.transaction_type = 'produce') AS produce_count
     FROM work_order_tasks t JOIN work_orders wo ON wo.work_order_id = t.work_order_id JOIN products p ON p.product_id = wo.product_id
     WHERE t.id = $1`, [taskId]
  );
  assert.deepEqual(state.rows[0], { task_status: "COMPLETED", work_order_status: "Completed", stock: 4, produce_count: 1 });
});

test("PostgreSQL AOV concurrent prerequisites unlock the join only after both complete", async (t) => {
  let pool;
  try { pool = await createDatabase(); } catch (error) { t.skip(`PostgreSQL unavailable: ${error.message}`); return; }
  t.after(() => pool.end());
  const seed = await seedBase(pool);
  const app = createApp({ pool }); const auth = token(seed.userId);
  const graphId = await publishedGraph(app, auth, seed.productId,
    [{ node_key: "A", name: "A", duration: 1 }, { node_key: "B", name: "B", duration: 1 }, { node_key: "C", name: "C", duration: 1 }, { node_key: "D", name: "D", duration: 1 }],
    [{ from: "A", to: "B" }, { from: "A", to: "C" }, { from: "B", to: "D" }, { from: "C", to: "D" }]);
  const workOrderId = await createAovWorkOrder(app, auth, seed, graphId);
  const read = async () => (await request(app, "GET", `/api/work-orders/${workOrderId}/tasks`, undefined, auth)).body.tasks;
  const task = async key => (await read()).find(item => item.node_key_snapshot === key);
  let a = await task("A");
  await request(app, "POST", `/api/work-orders/${workOrderId}/tasks/${a.id}/start`, undefined, auth);
  await request(app, "POST", `/api/work-orders/${workOrderId}/tasks/${a.id}/complete`, undefined, auth);
  const b = await task("B"); const c = await task("C");
  await Promise.all([
    request(app, "POST", `/api/work-orders/${workOrderId}/tasks/${b.id}/start`, undefined, auth),
    request(app, "POST", `/api/work-orders/${workOrderId}/tasks/${c.id}/start`, undefined, auth)
  ]);
  const completed = await Promise.all([
    request(app, "POST", `/api/work-orders/${workOrderId}/tasks/${b.id}/complete`, undefined, auth),
    request(app, "POST", `/api/work-orders/${workOrderId}/tasks/${c.id}/complete`, undefined, auth)
  ]);
  assert.deepEqual(completed.map(result => result.statusCode).sort(), [200, 200]);
  const d = await task("D");
  assert.equal(d.status, "READY");
});
