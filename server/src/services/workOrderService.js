const { createHttpError } = require("../middleware/errorHandler");

const COLUMNS = `work_order_id, product_id, quantity, line, mold_id, status, creator_user_id, creator_name, aov_graph_id, created_at, updated_at`;

async function lockWorkOrder(client, workOrderId) {
  const result = await client.query(`SELECT ${COLUMNS} FROM work_orders WHERE work_order_id = $1 FOR UPDATE`, [workOrderId]);
  if (!result.rows[0]) throw createHttpError(404, "Work order not found");
  return result.rows[0];
}

async function startLockedWorkOrder(client, wo) {
  if (wo.status === "In_Progress") return wo;
  if (wo.status !== "Pending") throw createHttpError(409, `Cannot start work order: current status is '${wo.status}', expected 'Pending'`);
  const mold = await client.query("SELECT mold_id, status FROM molds WHERE mold_id = $1 FOR UPDATE", [wo.mold_id]);
  if (!mold.rows[0]) throw createHttpError(400, "Mold not found");
  if (mold.rows[0].status !== "Idle") throw createHttpError(409, "Mold is currently in use");
  await client.query(
    `UPDATE molds SET status = 'In_Use', product_id = $1, updated_at = now() WHERE mold_id = $2`,
    [wo.product_id, wo.mold_id]
  );
  const updated = await client.query(
    `UPDATE work_orders SET status = 'In_Progress', updated_at = now() WHERE work_order_id = $1 RETURNING ${COLUMNS}`,
    [wo.work_order_id]
  );
  await client.query(
    `INSERT INTO system_logs(level, message, work_order_id, created_by_user_id) VALUES ($1, $2, $3, $4)`,
    ["INFO", `Work order ${wo.work_order_id} started (Pending -> In_Progress)`, wo.work_order_id, wo.creator_user_id]
  );
  return updated.rows[0];
}

async function completeLockedWorkOrder(client, wo) {
  if (wo.status !== "Pending" && wo.status !== "In_Progress") {
    throw createHttpError(409, `Cannot complete work order: current status is '${wo.status}', expected 'Pending' or 'In_Progress'`);
  }
  const mold = await client.query("SELECT mold_id FROM molds WHERE mold_id = $1 FOR UPDATE", [wo.mold_id]);
  if (!mold.rows[0]) throw createHttpError(400, "Mold not found");
  const product = await client.query("SELECT product_id FROM products WHERE product_id = $1 FOR UPDATE", [wo.product_id]);
  if (!product.rows[0]) throw createHttpError(400, "Product not found");
  await client.query("UPDATE molds SET status = 'Idle', product_id = NULL, updated_at = now() WHERE mold_id = $1", [wo.mold_id]);
  await client.query("UPDATE products SET stock = stock + $1, updated_at = now() WHERE product_id = $2", [wo.quantity, wo.product_id]);
  await client.query(
    `INSERT INTO inventory_transactions(work_order_id, material_id, product_id, transaction_type, quantity, created_by_user_id)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [wo.work_order_id, null, wo.product_id, "produce", wo.quantity, wo.creator_user_id]
  );
  const updated = await client.query(
    `UPDATE work_orders SET status = 'Completed', updated_at = now() WHERE work_order_id = $1 RETURNING ${COLUMNS}`,
    [wo.work_order_id]
  );
  await client.query(
    `INSERT INTO system_logs(level, message, work_order_id, created_by_user_id) VALUES ($1, $2, $3, $4)`,
    ["INFO", `Work order ${wo.work_order_id} completed (${wo.status} -> Completed)`, wo.work_order_id, wo.creator_user_id]
  );
  return updated.rows[0];
}

module.exports = { COLUMNS, lockWorkOrder, startLockedWorkOrder, completeLockedWorkOrder };
