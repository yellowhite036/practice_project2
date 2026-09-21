const { Router } = require("express");
const { createHttpError } = require("../middleware/errorHandler");
const { requireAuth, requireRole } = require("../middleware/auth");
const withTransaction = require("../db/withTransaction");
const { listTasks, startTask, completeTask } = require("../services/workOrderTaskService");
const { loadGraph } = require("../services/aovGraphService");

const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const readers = ["admin", "manager", "operator"];
const writers = ["admin", "manager", "operator"];
const tx = (pool, callback) => typeof pool.withTransaction === "function" ? pool.withTransaction(callback) : withTransaction(pool, callback);

module.exports = function createWorkOrderTasksRouter(pool) {
  const router = Router({ mergeParams: true });
  router.get("/:id/tasks", requireAuth, requireRole(readers), asyncRoute(async (req, res) => {
    res.json(await listTasks(pool, req.params.id));
  }));
  router.get("/:id/tasks/graph", requireAuth, requireRole(readers), asyncRoute(async (req, res) => {
    const wo = await pool.query("SELECT work_order_id, aov_graph_id FROM work_orders WHERE work_order_id = $1", [req.params.id]);
    if (!wo.rows[0]) throw createHttpError(404, "Work order not found");
    if (!wo.rows[0].aov_graph_id) throw createHttpError(404, "Work order has no AOV graph");
    const [graph, taskData] = await Promise.all([loadGraph(pool, wo.rows[0].aov_graph_id), listTasks(pool, req.params.id)]);
    res.json({ nodes: graph.nodes, edges: graph.edges, tasks: taskData.tasks, dependencies: taskData.dependencies });
  }));
  router.post("/:id/tasks/:taskId/start", requireAuth, requireRole(writers), asyncRoute(async (req, res) => {
    const task = await tx(pool, client => startTask(client, req.params.id, req.params.taskId, req.user.user_id));
    res.json(task);
  }));
  router.post("/:id/tasks/:taskId/complete", requireAuth, requireRole(writers), asyncRoute(async (req, res) => {
    const result = await tx(pool, client => completeTask(client, req.params.id, req.params.taskId, req.user.user_id));
    res.json(result);
  }));
  return router;
};
