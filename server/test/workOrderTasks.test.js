const test = require("node:test");
const assert = require("node:assert/strict");
const { createTaskSnapshot, completeTask } = require("../src/services/workOrderTaskService");

function snapshotClient() {
  let nextTaskId = 100;
  const inserted = [];
  const dependencies = [];
  return {
    inserted, dependencies,
    async query(sql, params = []) {
      if (sql.includes("FROM aov_graphs")) return { rows: [{ id: 7, product_id: "P1", status: "Published" }] };
      if (sql.includes("FROM aov_nodes")) return { rows: [
        { id: 11, graph_id: 7, node_key: "A", name: "Prepare", duration: 5 },
        { id: 12, graph_id: 7, node_key: "B", name: "Build", duration: 10 },
        { id: 13, graph_id: 7, node_key: "C", name: "Inspect", duration: 3 }
      ] };
      if (sql.includes("FROM aov_edges")) return { rows: [
        { id: 1, graph_id: 7, from_node_id: 11, to_node_id: 12 },
        { id: 2, graph_id: 7, from_node_id: 11, to_node_id: 13 }
      ] };
      if (sql.includes("INSERT INTO work_order_tasks")) {
        const row = { id: nextTaskId++, work_order_id: params[0], aov_node_id: params[1], node_key_snapshot: params[2], name_snapshot: params[3], duration_snapshot: params[4], status: params[5] };
        inserted.push(row); return { rows: [row] };
      }
      if (sql.includes("INSERT INTO work_order_task_dependencies")) { dependencies.push({ task_id: params[0], prerequisite_task_id: params[1] }); return { rows: [] }; }
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
}

test("AOV work order snapshot preserves node fields and initializes dependency states", async () => {
  const client = snapshotClient();
  const tasks = await createTaskSnapshot(client, "WO-AOV-1", 7);
  assert.deepEqual(tasks.map(task => [task.node_key_snapshot, task.status]), [["A", "READY"], ["B", "LOCKED"], ["C", "LOCKED"]]);
  assert.deepEqual(client.dependencies, [{ task_id: 101, prerequisite_task_id: 100 }, { task_id: 102, prerequisite_task_id: 100 }]);
});

test("a completed task cannot be completed a second time", async () => {
  let status = "RUNNING";
  const client = {
    async query(sql, params = []) {
      if (sql.includes("FROM work_orders WHERE work_order_id") && sql.includes("FOR UPDATE")) return { rows: [{ work_order_id: "WO-1", product_id: "P1", quantity: 1, mold_id: "M1", status: "In_Progress", aov_graph_id: 7 }] };
      if (sql.includes("FROM work_order_tasks WHERE id") && sql.includes("FOR UPDATE")) return { rows: [{ id: 10, work_order_id: "WO-1", status }] };
      if (sql.includes("SET status = 'COMPLETED'")) { status = "COMPLETED"; return { rows: [{ id: 10, status }] }; }
      if (sql.includes("WHERE d.prerequisite_task_id")) return { rows: [] };
      if (sql.includes("status <> 'COMPLETED'")) return { rows: [{ exists: true }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  await completeTask(client, "WO-1", 10, "OP-1");
  await assert.rejects(() => completeTask(client, "WO-1", 10, "OP-1"), /Cannot complete task/);
});
