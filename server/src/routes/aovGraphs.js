const { Router } = require("express");
const { createHttpError } = require("../middleware/errorHandler");
const { requireAuth, requireRole } = require("../middleware/auth");
const withTransaction = require("../db/withTransaction");
const { loadGraph, validateGraph, normaliseNode } = require("../services/aovGraphService");

const asyncRoute = handler => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const readers = ["admin", "manager", "operator"];
const writers = ["admin", "manager"];

function tx(pool, callback) {
  return typeof pool.withTransaction === "function" ? pool.withTransaction(callback) : withTransaction(pool, callback);
}

function parseGraphBody(body) {
  const product_id = typeof body.product_id === "string" ? body.product_id.trim() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const version = Number(body.version ?? 1);
  if (!product_id) throw createHttpError(400, "product_id is required");
  if (!name) throw createHttpError(400, "name is required");
  if (!Number.isInteger(version) || version <= 0) throw createHttpError(400, "version must be a positive integer");
  if (!Array.isArray(body.nodes) || !Array.isArray(body.edges)) throw createHttpError(400, "nodes and edges must be arrays");
  const nodes = body.nodes.map(normaliseNode);
  const keys = new Set();
  for (const node of nodes) {
    if (keys.has(node.node_key)) throw createHttpError(400, `Duplicate node_key '${node.node_key}'`);
    keys.add(node.node_key);
  }
  const edges = body.edges.map(edge => ({
    from: typeof edge?.from === "string" ? edge.from.trim() : "",
    to: typeof edge?.to === "string" ? edge.to.trim() : ""
  }));
  for (const edge of edges) {
    if (!keys.has(edge.from)) throw createHttpError(400, "Edge source node does not exist in graph");
    if (!keys.has(edge.to)) throw createHttpError(400, "Edge target node does not exist in graph");
    if (edge.from === edge.to) throw createHttpError(400, "AOV edge cannot connect a node to itself");
  }
  return { product_id, name, description: body.description ?? null, version, nodes, edges };
}

async function insertGraphContents(client, graphId, nodes, edges) {
  const nodeByKey = new Map();
  for (const node of nodes) {
    const result = await client.query(
      `INSERT INTO aov_nodes(graph_id, node_key, name, duration, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, graph_id, node_key, name, duration, description, created_at, updated_at`,
      [graphId, node.node_key, node.name, node.duration, node.description]
    );
    nodeByKey.set(node.node_key, result.rows[0]);
  }
  const seen = new Set();
  for (const edge of edges) {
    const key = `${edge.from}:${edge.to}`;
    if (seen.has(key)) throw createHttpError(400, "Duplicate AOV edge");
    seen.add(key);
    await client.query(
      `INSERT INTO aov_edges(graph_id, from_node_id, to_node_id)
       VALUES ($1, $2, $3)`,
      [graphId, nodeByKey.get(edge.from).id, nodeByKey.get(edge.to).id]
    );
  }
}

module.exports = function createAovGraphsRouter(pool) {
  const router = Router();

  router.post("/", requireAuth, requireRole(writers), asyncRoute(async (req, res) => {
    const input = parseGraphBody(req.body);
    const created = await tx(pool, async client => {
      const product = await client.query("SELECT product_id FROM products WHERE product_id = $1", [input.product_id]);
      if (!product.rows[0]) throw createHttpError(400, "Product not found");
      const graph = await client.query(
        `INSERT INTO aov_graphs(product_id, name, description, version, status, created_by_user_id)
         VALUES ($1, $2, $3, $4, 'Draft', $5)
         RETURNING id`,
        [input.product_id, input.name, input.description, input.version, req.user.user_id]
      );
      await insertGraphContents(client, graph.rows[0].id, input.nodes, input.edges);
      return loadGraph(client, graph.rows[0].id);
    });
    res.status(201).json(created);
  }));

  router.get("/", requireAuth, requireRole(readers), asyncRoute(async (req, res) => {
    const params = [];
    let where = "";
    if (req.query.product_id) { params.push(req.query.product_id); where = "WHERE product_id = $1"; }
    const result = await pool.query(
      `SELECT id, product_id, name, description, version, status, created_by_user_id, created_at, updated_at
       FROM aov_graphs ${where} ORDER BY product_id, version DESC, id DESC`, params
    );
    res.json(result.rows);
  }));

  router.get("/:graphId", requireAuth, requireRole(readers), asyncRoute(async (req, res) => {
    res.json(await loadGraph(pool, req.params.graphId));
  }));

  router.put("/:graphId", requireAuth, requireRole(writers), asyncRoute(async (req, res) => {
    const input = parseGraphBody(req.body);
    const updated = await tx(pool, async client => {
      const current = await loadGraph(client, req.params.graphId, { forUpdate: true });
      if (current.graph.status === "Published") throw createHttpError(409, "Published AOV graph cannot be modified; create a new version");
      const product = await client.query("SELECT product_id FROM products WHERE product_id = $1", [input.product_id]);
      if (!product.rows[0]) throw createHttpError(400, "Product not found");
      await client.query(
        `UPDATE aov_graphs SET product_id = $1, name = $2, description = $3, version = $4, updated_at = now()
         WHERE id = $5`, [input.product_id, input.name, input.description, input.version, req.params.graphId]
      );
      await client.query("DELETE FROM aov_edges WHERE graph_id = $1", [req.params.graphId]);
      await client.query("DELETE FROM aov_nodes WHERE graph_id = $1", [req.params.graphId]);
      await insertGraphContents(client, req.params.graphId, input.nodes, input.edges);
      return loadGraph(client, req.params.graphId);
    });
    res.json(updated);
  }));

  router.post("/:graphId/validate", requireAuth, requireRole(readers), asyncRoute(async (req, res) => {
    const result = await loadGraph(pool, req.params.graphId);
    const order = validateGraph(result.graph, result.nodes, result.edges);
    res.json({ valid: true, topological_order: order.map(node => node.id) });
  }));

  router.post("/:graphId/publish", requireAuth, requireRole(writers), asyncRoute(async (req, res) => {
    const published = await tx(pool, async client => {
      const result = await loadGraph(client, req.params.graphId, { forUpdate: true });
      if (result.graph.status === "Published") throw createHttpError(409, "AOV graph is already published");
      validateGraph(result.graph, result.nodes, result.edges);
      const update = await client.query(
        `UPDATE aov_graphs SET status = 'Published', updated_at = now()
         WHERE id = $1 RETURNING id, product_id, name, description, version, status, created_by_user_id, created_at, updated_at`,
        [req.params.graphId]
      );
      return { ...result, graph: update.rows[0] };
    });
    res.json(published);
  }));

  return router;
};
