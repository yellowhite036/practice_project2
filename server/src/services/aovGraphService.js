const { createHttpError } = require("../middleware/errorHandler");

function graphError(message) {
  return createHttpError(400, message);
}

function normaliseNode(node) {
  const node_key = typeof node?.node_key === "string" ? node.node_key.trim() : "";
  const name = typeof node?.name === "string" ? node.name.trim() : "";
  const duration = Number(node?.duration ?? 0);
  if (!node_key) throw graphError("node_key is required");
  if (!name) throw graphError(`Node '${node_key}' name is required`);
  if (!Number.isInteger(duration) || duration < 0) throw graphError(`Node '${node_key}' duration must be a non-negative integer`);
  return { node_key, name, duration, description: node?.description ?? null };
}

function validateGraph(graph, nodes = [], edges = []) {
  if (!graph) throw graphError("AOV graph not found");
  if (!Array.isArray(nodes) || nodes.length === 0) throw graphError("Graph must contain at least one node");
  const byId = new Map();
  const keys = new Set();
  for (const rawNode of nodes) {
    const node = normaliseNode(rawNode);
    if (keys.has(node.node_key)) throw graphError(`Duplicate node_key '${node.node_key}'`);
    keys.add(node.node_key);
    if (rawNode.id !== undefined) byId.set(Number(rawNode.id), rawNode);
  }
  const edgeKeys = new Set();
  for (const edge of edges || []) {
    const from = Number(edge.from_node_id);
    const to = Number(edge.to_node_id);
    if (!byId.has(from)) throw graphError("Edge source node does not exist in graph");
    if (!byId.has(to)) throw graphError("Edge target node does not exist in graph");
    if (from === to) throw graphError("AOV edge cannot connect a node to itself");
    const key = `${from}:${to}`;
    if (edgeKeys.has(key)) throw graphError("Duplicate AOV edge");
    edgeKeys.add(key);
  }
  return topologicalSort(nodes, edges);
}

function topologicalSort(nodes, edges = []) {
  const byId = new Map(nodes.map(node => [Number(node.id), node]));
  if (byId.size !== nodes.length || [...byId.keys()].some(Number.isNaN)) {
    throw graphError("All graph nodes must have an id before topological sort");
  }
  const indegree = new Map(nodes.map(node => [Number(node.id), 0]));
  const next = new Map(nodes.map(node => [Number(node.id), []]));
  for (const edge of edges) {
    const from = Number(edge.from_node_id);
    const to = Number(edge.to_node_id);
    if (!byId.has(from) || !byId.has(to)) throw graphError("Edge references a node outside the graph");
    indegree.set(to, indegree.get(to) + 1);
    next.get(from).push(to);
  }
  const ready = [...nodes].filter(node => indegree.get(Number(node.id)) === 0)
    .sort((a, b) => Number(a.id) - Number(b.id));
  const sorted = [];
  while (ready.length) {
    const node = ready.shift();
    sorted.push(node);
    for (const child of next.get(Number(node.id)).sort((a, b) => a - b)) {
      indegree.set(child, indegree.get(child) - 1);
      if (indegree.get(child) === 0) {
        ready.push(byId.get(child));
        ready.sort((a, b) => Number(a.id) - Number(b.id));
      }
    }
  }
  if (sorted.length !== nodes.length) throw graphError("AOV graph contains a cycle");
  return sorted;
}

async function loadGraph(client, graphId, { forUpdate = false } = {}) {
  const graph = await client.query(
    `SELECT id, product_id, name, description, version, status, created_by_user_id, created_at, updated_at
     FROM aov_graphs WHERE id = $1${forUpdate ? " FOR UPDATE" : ""}`,
    [graphId]
  );
  if (!graph.rows[0]) throw createHttpError(404, "AOV graph not found");
  const [nodes, edges] = await Promise.all([
    client.query(`SELECT id, graph_id, node_key, name, duration, description, created_at, updated_at
                  FROM aov_nodes WHERE graph_id = $1 ORDER BY id`, [graphId]),
    client.query(`SELECT id, graph_id, from_node_id, to_node_id, created_at
                  FROM aov_edges WHERE graph_id = $1 ORDER BY id`, [graphId])
  ]);
  return { graph: graph.rows[0], nodes: nodes.rows, edges: edges.rows };
}

module.exports = { validateGraph, topologicalSort, loadGraph, normaliseNode };
