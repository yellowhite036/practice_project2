const test = require("node:test");
const assert = require("node:assert/strict");
const { validateGraph, topologicalSort } = require("../src/services/aovGraphService");

const graph = { id: 1, status: "Draft" };
const nodes = [
  { id: 1, node_key: "A", name: "Prepare", duration: 10 },
  { id: 2, node_key: "B", name: "Mold", duration: 30 },
  { id: 3, node_key: "C", name: "Assemble", duration: 15 }
];

test("AOV validation accepts a DAG and returns a complete topological order", () => {
  const edges = [{ from_node_id: 1, to_node_id: 2 }, { from_node_id: 2, to_node_id: 3 }];
  assert.deepEqual(validateGraph(graph, nodes, edges).map(node => node.node_key), ["A", "B", "C"]);
  assert.deepEqual(topologicalSort(nodes, edges).map(node => node.id), [1, 2, 3]);
});

test("AOV validation rejects duplicate node keys, invalid edges, and cycles", () => {
  assert.throws(() => validateGraph(graph, [...nodes, { id: 4, node_key: "A", name: "Duplicate", duration: 0 }], []), /Duplicate node_key/);
  assert.throws(() => validateGraph(graph, nodes, [{ from_node_id: 1, to_node_id: 1 }]), /cannot connect/);
  assert.throws(() => validateGraph(graph, nodes, [{ from_node_id: 1, to_node_id: 99 }]), /target node/);
  assert.throws(() => validateGraph(graph, nodes, [{ from_node_id: 1, to_node_id: 2 }, { from_node_id: 2, to_node_id: 1 }]), /cycle/);
});

test("AOV validation requires populated, valid nodes", () => {
  assert.throws(() => validateGraph(graph, [], []), /at least one node/);
  assert.throws(() => validateGraph(graph, [{ id: 1, node_key: "A", name: " ", duration: 0 }], []), /name is required/);
  assert.throws(() => validateGraph(graph, [{ id: 1, node_key: "A", name: "A", duration: -1 }], []), /non-negative/);
});
