CREATE TABLE aov_graphs (
  id BIGSERIAL PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES products(product_id),
  name TEXT NOT NULL,
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'Draft',
  created_by_user_id TEXT REFERENCES users(user_id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT aov_graphs_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT aov_graphs_version_check CHECK (version > 0),
  CONSTRAINT aov_graphs_status_check CHECK (status IN ('Draft', 'Published')),
  CONSTRAINT aov_graphs_product_version_unique UNIQUE (product_id, version)
);

CREATE TABLE aov_nodes (
  id BIGSERIAL PRIMARY KEY,
  graph_id BIGINT NOT NULL REFERENCES aov_graphs(id) ON DELETE RESTRICT,
  node_key TEXT NOT NULL,
  name TEXT NOT NULL,
  duration INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT aov_nodes_key_unique UNIQUE (graph_id, node_key),
  CONSTRAINT aov_nodes_graph_id_id_unique UNIQUE (graph_id, id),
  CONSTRAINT aov_nodes_name_check CHECK (btrim(name) <> ''),
  CONSTRAINT aov_nodes_duration_check CHECK (duration >= 0)
);

CREATE TABLE aov_edges (
  id BIGSERIAL PRIMARY KEY,
  graph_id BIGINT NOT NULL REFERENCES aov_graphs(id) ON DELETE RESTRICT,
  from_node_id BIGINT NOT NULL,
  to_node_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT aov_edges_unique UNIQUE (from_node_id, to_node_id),
  CONSTRAINT aov_edges_not_self CHECK (from_node_id <> to_node_id),
  CONSTRAINT aov_edges_from_node_fk FOREIGN KEY (graph_id, from_node_id)
    REFERENCES aov_nodes(graph_id, id) ON DELETE RESTRICT,
  CONSTRAINT aov_edges_to_node_fk FOREIGN KEY (graph_id, to_node_id)
    REFERENCES aov_nodes(graph_id, id) ON DELETE RESTRICT
);

ALTER TABLE work_orders
  ADD COLUMN IF NOT EXISTS aov_graph_id BIGINT REFERENCES aov_graphs(id);

CREATE TABLE work_order_tasks (
  id BIGSERIAL PRIMARY KEY,
  work_order_id TEXT NOT NULL REFERENCES work_orders(work_order_id) ON DELETE RESTRICT,
  aov_node_id BIGINT NOT NULL REFERENCES aov_nodes(id) ON DELETE RESTRICT,
  node_key_snapshot TEXT NOT NULL,
  name_snapshot TEXT NOT NULL,
  duration_snapshot INTEGER NOT NULL,
  status TEXT NOT NULL,
  unlocked_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  started_by_user_id TEXT,
  completed_by_user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT work_order_tasks_node_unique UNIQUE (work_order_id, aov_node_id),
  CONSTRAINT work_order_tasks_status_check CHECK (status IN ('LOCKED', 'READY', 'RUNNING', 'COMPLETED')),
  CONSTRAINT work_order_tasks_duration_check CHECK (duration_snapshot >= 0)
);

CREATE TABLE work_order_task_dependencies (
  task_id BIGINT NOT NULL REFERENCES work_order_tasks(id) ON DELETE RESTRICT,
  prerequisite_task_id BIGINT NOT NULL REFERENCES work_order_tasks(id) ON DELETE RESTRICT,
  PRIMARY KEY (task_id, prerequisite_task_id),
  CONSTRAINT work_order_task_dependencies_not_self CHECK (task_id <> prerequisite_task_id)
);

CREATE INDEX aov_graphs_product_id_idx ON aov_graphs(product_id);
CREATE INDEX aov_nodes_graph_id_idx ON aov_nodes(graph_id);
CREATE INDEX aov_edges_graph_id_idx ON aov_edges(graph_id);
CREATE INDEX work_orders_aov_graph_id_idx ON work_orders(aov_graph_id);
CREATE INDEX work_order_tasks_work_order_id_idx ON work_order_tasks(work_order_id);
CREATE INDEX work_order_task_dependencies_prerequisite_idx ON work_order_task_dependencies(prerequisite_task_id);
