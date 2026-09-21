const { createHttpError } = require("../middleware/errorHandler");
const { loadGraph, validateGraph } = require("./aovGraphService");
const { lockWorkOrder, startLockedWorkOrder, completeLockedWorkOrder } = require("./workOrderService");

async function createTaskSnapshot(client, workOrderId, graphId) {
  const source = await loadGraph(client, graphId, { forUpdate: true });
  if (source.graph.status !== "Published") throw createHttpError(409, "AOV graph must be Published");
  validateGraph(source.graph, source.nodes, source.edges);
  const tasks = new Map();
  const prerequisiteNodeIds = new Set(source.edges.map(edge => Number(edge.to_node_id)));
  for (const node of source.nodes) {
    const ready = !prerequisiteNodeIds.has(Number(node.id));
    const inserted = await client.query(
      `INSERT INTO work_order_tasks(work_order_id, aov_node_id, node_key_snapshot, name_snapshot, duration_snapshot, status, unlocked_at)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $6 = 'READY' THEN now() ELSE NULL END)
       RETURNING id, work_order_id, aov_node_id, node_key_snapshot, name_snapshot, duration_snapshot, status, unlocked_at, started_at, completed_at, started_by_user_id, completed_by_user_id, created_at, updated_at`,
      [workOrderId, node.id, node.node_key, node.name, node.duration, ready ? "READY" : "LOCKED"]
    );
    tasks.set(Number(node.id), inserted.rows[0]);
  }
  for (const edge of source.edges) {
    await client.query(
      `INSERT INTO work_order_task_dependencies(task_id, prerequisite_task_id) VALUES ($1, $2)`,
      [tasks.get(Number(edge.to_node_id)).id, tasks.get(Number(edge.from_node_id)).id]
    );
  }
  return [...tasks.values()];
}

async function listTasks(client, workOrderId) {
  const tasks = await client.query(
    `SELECT id, work_order_id, aov_node_id, node_key_snapshot, name_snapshot, duration_snapshot, status,
            unlocked_at, started_at, completed_at, started_by_user_id, completed_by_user_id, created_at, updated_at
     FROM work_order_tasks WHERE work_order_id = $1 ORDER BY id`, [workOrderId]
  );
  const dependencies = await client.query(
    `SELECT d.task_id, d.prerequisite_task_id
     FROM work_order_task_dependencies d JOIN work_order_tasks t ON t.id = d.task_id
     WHERE t.work_order_id = $1 ORDER BY d.task_id, d.prerequisite_task_id`, [workOrderId]
  );
  const byTask = new Map(tasks.rows.map(task => [String(task.id), { ...task, dependencies: [] }]));
  for (const dependency of dependencies.rows) byTask.get(String(dependency.task_id))?.dependencies.push(dependency.prerequisite_task_id);
  return { tasks: [...byTask.values()], dependencies: dependencies.rows };
}

async function startTask(client, workOrderId, taskId, userId) {
  const wo = await lockWorkOrder(client, workOrderId);
  if (!wo.aov_graph_id) throw createHttpError(409, "Work order does not use an AOV graph");
  const taskResult = await client.query(
    `SELECT id, work_order_id, status FROM work_order_tasks WHERE id = $1 AND work_order_id = $2 FOR UPDATE`, [taskId, workOrderId]
  );
  const task = taskResult.rows[0];
  if (!task) throw createHttpError(404, "Work order task not found");
  if (task.status !== "READY") throw createHttpError(409, `Cannot start task: current status is '${task.status}', expected 'READY'`);
  if (wo.status === "Pending") await startLockedWorkOrder(client, wo);
  else if (wo.status !== "In_Progress") throw createHttpError(409, `Cannot start task for work order in '${wo.status}' state`);
  const updated = await client.query(
    `UPDATE work_order_tasks SET status = 'RUNNING', started_at = now(), started_by_user_id = $1, updated_at = now()
     WHERE id = $2 RETURNING id, work_order_id, aov_node_id, node_key_snapshot, name_snapshot, duration_snapshot, status, unlocked_at, started_at, completed_at, started_by_user_id, completed_by_user_id, created_at, updated_at`,
    [userId, taskId]
  );
  return updated.rows[0];
}

async function completeTask(client, workOrderId, taskId, userId) {
  const wo = await lockWorkOrder(client, workOrderId);
  if (!wo.aov_graph_id) throw createHttpError(409, "Work order does not use an AOV graph");
  const taskResult = await client.query(
    `SELECT id, work_order_id, status FROM work_order_tasks WHERE id = $1 AND work_order_id = $2 FOR UPDATE`, [taskId, workOrderId]
  );
  const task = taskResult.rows[0];
  if (!task) throw createHttpError(404, "Work order task not found");
  if (task.status !== "RUNNING") throw createHttpError(409, `Cannot complete task: current status is '${task.status}', expected 'RUNNING'`);
 const completed = await client.query(
   `UPDATE work_order_tasks SET status = 'COMPLETED', completed_at = now(), completed_by_user_id = $1, updated_at = now()
    WHERE id = $2 RETURNING id, work_order_id, aov_node_id, node_key_snapshot, name_snapshot, duration_snapshot, status, unlocked_at, started_at, completed_at, started_by_user_id, completed_by_user_id, created_at, updated_at`,
   [userId, taskId]
 );
  const children = await client.query(
    `SELECT child.id
     FROM work_order_task_dependencies d JOIN work_order_tasks child ON child.id = d.task_id
     WHERE d.prerequisite_task_id = $1
     ORDER BY child.id
     FOR UPDATE`, [taskId]
  );
 const unlocked = [];
  for (const child of children.rows) {
    const blocked = await client.query(
      `SELECT 1 FROM work_order_task_dependencies d JOIN work_order_tasks prerequisite ON prerequisite.id = d.prerequisite_task_id
       WHERE d.task_id = $1 AND prerequisite.status <> 'COMPLETED' LIMIT 1`, [child.id]
    );
    if (!blocked.rows[0]) {
      const result = await client.query(
        `UPDATE work_order_tasks SET status = 'READY', unlocked_at = now(), updated_at = now()
         WHERE id = $1 AND status = 'LOCKED' RETURNING id`, [child.id]
      );
      if (result.rows[0]) unlocked.push(result.rows[0].id);
    }
  }
  const unfinished = await client.query(
    `SELECT 1 FROM work_order_tasks WHERE work_order_id = $1 AND status <> 'COMPLETED' LIMIT 1`, [workOrderId]
  );
  let workOrder = null;
  if (!unfinished.rows[0]) workOrder = await completeLockedWorkOrder(client, wo);
  return { task: completed.rows[0], unlocked_task_ids: unlocked, work_order: workOrder };
}

module.exports = { createTaskSnapshot, listTasks, startTask, completeTask };
