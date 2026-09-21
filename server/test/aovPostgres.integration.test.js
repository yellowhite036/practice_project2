const test = require("node:test");
const assert = require("node:assert/strict");
const createApp = require("../src/app");
const { createDatabase, seedBase, request, token, dagPayload } = require("./utils/aovPostgresHarness");

test("PostgreSQL AOV graph, task lifecycle, and bypass protection", async (t) => {
  let pool;
  try { pool = await createDatabase(); } catch (error) { t.skip(`PostgreSQL unavailable: ${error.message}`); return; }
  t.after(() => pool.end());
  const seed = await seedBase(pool);
  const app = createApp({ pool });
  const auth = token(seed.userId);

  const createGraph = await request(app, "POST", "/api/aov-graphs", dagPayload(seed.productId), auth);
  assert.equal(createGraph.statusCode, 201);
  const graphId = createGraph.body.graph.id;
  assert.equal(createGraph.body.nodes.length, 5);
  assert.equal(createGraph.body.edges.length, 5);
  assert.equal((await request(app, "POST", `/api/aov-graphs/${graphId}/validate`, undefined, auth)).body.valid, true);
  const publish = await request(app, "POST", `/api/aov-graphs/${graphId}/publish`, undefined, auth);
  assert.equal(publish.statusCode, 200);
  assert.equal(publish.body.graph.status, "Published");
  const read = await request(app, "GET", `/api/aov-graphs/${graphId}`, undefined, auth);
  assert.equal(read.body.graph.status, "Published");
  const mutate = await request(app, "PUT", `/api/aov-graphs/${graphId}`, dagPayload(seed.productId), auth);
  assert.equal(mutate.statusCode, 409);

  const createWo = await request(app, "POST", "/api/work-orders", { product_id: seed.productId, quantity: 3, line: "L1", mold_id: seed.moldId, aov_graph_id: graphId }, auth);
  assert.equal(createWo.statusCode, 201);
  const workOrderId = createWo.body.work_order_id;
  assert.match(workOrderId, /^WO-\d{6}-\d{5,}$/);
  const wo = await pool.query("SELECT aov_graph_id, status FROM work_orders WHERE work_order_id = $1", [workOrderId]);
  assert.deepEqual(wo.rows[0], { aov_graph_id: String(graphId), status: "Pending" });
  const moldBeforeStart = await pool.query("SELECT status FROM molds WHERE mold_id = $1", [seed.moldId]);
  assert.equal(moldBeforeStart.rows[0].status, "Idle");

  let taskData = await request(app, "GET", `/api/work-orders/${workOrderId}/tasks`, undefined, auth);
  assert.equal(taskData.statusCode, 200);
  assert.equal(taskData.body.tasks.length, 5);
  assert.equal(taskData.body.dependencies.length, 5);
  const byKey = () => new Map(taskData.body.tasks.map(task => [task.node_key_snapshot, task]));
  assert.deepEqual([...byKey()].map(([key, task]) => [key, task.status]), [["A", "READY"], ["B", "LOCKED"], ["C", "LOCKED"], ["D", "LOCKED"], ["E", "LOCKED"]]);
  assert.deepEqual([...byKey()].map(([key, task]) => [key, task.name_snapshot, Number(task.duration_snapshot)]), [["A", "Prepare", 10], ["B", "Mold", 30], ["C", "Metal", 20], ["D", "Assemble", 15], ["E", "Inspect", 10]]);

  const completeByKey = async key => {
    const task = byKey().get(key);
    assert.equal((await request(app, "POST", `/api/work-orders/${workOrderId}/tasks/${task.id}/start`, undefined, auth)).statusCode, 200);
    return request(app, "POST", `/api/work-orders/${workOrderId}/tasks/${task.id}/complete`, undefined, auth);
  };
  assert.equal((await completeByKey("A")).statusCode, 200);
  taskData = await request(app, "GET", `/api/work-orders/${workOrderId}/tasks`, undefined, auth);
  assert.equal(byKey().get("A").status, "COMPLETED"); assert.equal(byKey().get("B").status, "READY"); assert.equal(byKey().get("C").status, "READY");
  assert.equal((await completeByKey("B")).statusCode, 200);
  taskData = await request(app, "GET", `/api/work-orders/${workOrderId}/tasks`, undefined, auth);
  assert.equal(byKey().get("D").status, "LOCKED");
  assert.equal((await completeByKey("C")).statusCode, 200);
  taskData = await request(app, "GET", `/api/work-orders/${workOrderId}/tasks`, undefined, auth);
  assert.equal(byKey().get("D").status, "READY");
  assert.equal((await completeByKey("D")).statusCode, 200);
  taskData = await request(app, "GET", `/api/work-orders/${workOrderId}/tasks`, undefined, auth);
  assert.equal(byKey().get("E").status, "READY");
  assert.equal((await completeByKey("E")).statusCode, 200);
  const completed = await pool.query("SELECT status FROM work_orders WHERE work_order_id = $1", [workOrderId]);
  assert.equal(completed.rows[0].status, "Completed");
  const product = await pool.query("SELECT stock FROM products WHERE product_id = $1", [seed.productId]);
  assert.equal(Number(product.rows[0].stock), 3);
  const produce = await pool.query("SELECT quantity FROM inventory_transactions WHERE work_order_id = $1 AND transaction_type = 'produce'", [workOrderId]);
  assert.deepEqual(produce.rows.map(row => Number(row.quantity)), [3]);
  const mold = await pool.query("SELECT status FROM molds WHERE mold_id = $1", [seed.moldId]);
  assert.equal(mold.rows[0].status, "Idle");

  const bypassWo = await request(app, "POST", "/api/work-orders", { product_id: seed.productId, quantity: 2, line: "L1", mold_id: seed.moldId, aov_graph_id: graphId }, auth);
  const bypass = await request(app, "POST", `/api/work-orders/${bypassWo.body.work_order_id}/complete`, undefined, auth);
  assert.equal(bypass.statusCode, 409);
  const bypassState = await pool.query("SELECT status FROM work_orders WHERE work_order_id = $1", [bypassWo.body.work_order_id]);
  assert.equal(bypassState.rows[0].status, "Pending");
  const bypassProduce = await pool.query("SELECT count(*)::int AS count FROM inventory_transactions WHERE work_order_id = $1 AND transaction_type = 'produce'", [bypassWo.body.work_order_id]);
  assert.equal(bypassProduce.rows[0].count, 0);
});
