const test = require("node:test");
const assert = require("node:assert/strict");
const { completeTask } = require("../src/services/workOrderTaskService");

test("task completion rejects a stale second completion after the row lock observes COMPLETED", async () => {
  let status = "RUNNING";
  const client = {
    async query(sql) {
      if (sql.includes("FROM work_orders WHERE work_order_id") && sql.includes("FOR UPDATE")) return { rows: [{ work_order_id: "WO-C", product_id: "P", quantity: 1, mold_id: "M", status: "In_Progress", aov_graph_id: 1 }] };
      if (sql.includes("FROM work_order_tasks WHERE id") && sql.includes("FOR UPDATE")) return { rows: [{ id: 1, work_order_id: "WO-C", status }] };
      if (sql.includes("SET status = 'COMPLETED'")) { status = "COMPLETED"; return { rows: [{ id: 1, status }] }; }
      if (sql.includes("WHERE d.prerequisite_task_id")) return { rows: [] };
      if (sql.includes("status <> 'COMPLETED'")) return { rows: [{ exists: true }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    }
  };
  await completeTask(client, "WO-C", 1, "OP-1");
  await assert.rejects(() => completeTask(client, "WO-C", 1, "OP-2"), error => error.status === 409);
});
