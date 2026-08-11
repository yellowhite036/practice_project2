const { Router } = require("express");
const { createHttpError } = require("../middleware/errorHandler");
const withTransaction = require("../db/withTransaction");

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const WORK_ORDER_COLUMNS = `
  work_order_id,
  product_id,
  quantity,
  line,
  mold_id,
  status,
  creator_user_id,
  creator_name,
  created_at,
  updated_at
`;

function validateWorkOrder(body) {
  if (!body.work_order_id) return "work_order_id is required";
  if (!body.product_id) return "product_id is required";
  if (body.quantity === undefined || Number(body.quantity) <= 0) return "quantity must be greater than 0";
  if (!body.line) return "line is required";
  if (!body.mold_id) return "mold_id is required";
  return null;
}

/**
 * Production flow inside a single PostgreSQL Transaction:
 *
 * BEGIN
 * 1. Validate Product exists
 * 2. Get BOM items for the product
 * 3. Lock Materials via SELECT ... FOR UPDATE (batch)
 * 4. Check each Material stock >= required amount
 * 5. Lock Mold via SELECT ... FOR UPDATE
 * 6. Check Mold status === 'Idle'
 * 7. Deduct Material stock for each BOM item
 * 8. Create Inventory Transaction records (consume)
 * 9. Increase Product stock
 * 10. Update Mold status to 'In_Use'
 * 11. Insert Work Order (status = 'Pending')
 * 12. Insert System Log
 * COMMIT  (or ROLLBACK on any error)
 */
module.exports = function createWorkOrdersRouter(pool) {
  const router = Router();

  router.get("/", asyncRoute(async (req, res) => {
    const { rows } = await pool.query(`SELECT ${WORK_ORDER_COLUMNS} FROM work_orders ORDER BY created_at DESC, work_order_id DESC`);
    res.json(rows);
  }));

  router.get("/:id", asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT ${WORK_ORDER_COLUMNS} FROM work_orders WHERE work_order_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) throw createHttpError(404, "Work order not found");
    res.json(rows[0]);
  }));

  router.post("/", asyncRoute(async (req, res) => {
    const validationError = validateWorkOrder(req.body);
    if (validationError) throw createHttpError(400, validationError);

    const {
      work_order_id,
      product_id,
      quantity,
      line,
      mold_id,
      creator_user_id = null,
      creator_name = null
    } = req.body;

    const txFn = pool.withTransaction
      ? (cb) => pool.withTransaction(cb)
      : (cb) => withTransaction(pool, cb);

    const workOrder = await txFn(async (client) => {
      // 1. Validate Product
      const productResult = await client.query(
        "SELECT product_id FROM products WHERE product_id = $1",
        [product_id]
      );
      if (productResult.rows.length === 0) {
        throw createHttpError(400, "Product not found");
      }

      // 2. Get BOM items
      const bomResult = await client.query(
        "SELECT material_id, amount_per_unit FROM bom_table WHERE product_id = $1 ORDER BY material_id",
        [product_id]
      );
      const bomItems = bomResult.rows;

      // 3. Lock Materials FOR UPDATE (pessimistic lock), ordered by material_id to avoid deadlocks
      const materialIds = bomItems.map((b) => b.material_id);
      let lockedMaterials = [];
      if (materialIds.length > 0) {
        const lockResult = await client.query(
          "SELECT material_id, stock FROM materials WHERE material_id = ANY($1) ORDER BY material_id FOR UPDATE",
          [materialIds]
        );
        lockedMaterials = lockResult.rows;
      }

      // 4. Check each material has sufficient stock
      for (const bomItem of bomItems) {
        const required = Number(bomItem.amount_per_unit) * Number(quantity);
        const material = lockedMaterials.find((m) => m.material_id === bomItem.material_id);
        if (!material) {
          throw createHttpError(400, `Material ${bomItem.material_id} not found`);
        }
        const currentStock = Number(material.stock);
        if (currentStock < required) {
          throw createHttpError(409, `Insufficient stock for material ${bomItem.material_id}`);
        }
      }

      // 5. Lock Mold FOR UPDATE (pessimistic lock)
      const moldResult = await client.query(
        "SELECT status FROM molds WHERE mold_id = $1 FOR UPDATE",
        [mold_id]
      );
      if (moldResult.rows.length === 0) {
        throw createHttpError(400, "Mold not found");
      }

      // 6. Check Mold status
      if (moldResult.rows[0].status !== "Idle") {
        throw createHttpError(409, "Mold is currently in use");
      }

      // 7. Deduct Material stock & 8. Create Inventory Transaction records
      for (const bomItem of bomItems) {
        const required = Number(bomItem.amount_per_unit) * Number(quantity);

        // Deduct material stock
        await client.query(
          "UPDATE materials SET stock = stock - $1, updated_at = now() WHERE material_id = $2",
          [required, bomItem.material_id]
        );

        // Insert Inventory Transaction (consume)
        await client.query(
          `INSERT INTO inventory_transactions (work_order_id, material_id, product_id, transaction_type, quantity, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [work_order_id, bomItem.material_id, product_id, "consume", required, creator_user_id]
        );
      }

      // 9. Increase Product stock
      await client.query(
        "UPDATE products SET stock = stock + $1, updated_at = now() WHERE product_id = $2",
        [quantity, product_id]
      );

      // 10. Update Mold status to In_Use
      await client.query(
        "UPDATE molds SET status = 'In_Use', product_id = $1, updated_at = now() WHERE mold_id = $2",
        [product_id, mold_id]
      );

      // 11. Insert Work Order
      const woResult = await client.query(
        `INSERT INTO work_orders (work_order_id, product_id, quantity, line, mold_id, status, creator_user_id, creator_name)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING ${WORK_ORDER_COLUMNS}`,
        [work_order_id, product_id, quantity, line, mold_id, "Pending", creator_user_id, creator_name]
      );

      // 12. Insert System Log
      await client.query(
        `INSERT INTO system_logs (level, message, work_order_id, created_by_user_id)
         VALUES ($1, $2, $3, $4)`,
        ["INFO", `Work order ${work_order_id} created for product ${product_id}`, work_order_id, creator_user_id]
      );

      return woResult.rows[0];
    });

    res.status(201).json(workOrder);
  }));

  router.put("/:id", asyncRoute(async (req, res) => {
    // For PUT, validateWorkOrder expects work_order_id, so we inject it into the body for validation
    const bodyForValidation = { ...req.body, work_order_id: req.params.id };
    const error = validateWorkOrder(bodyForValidation);
    if (error) throw createHttpError(400, error);

    const { product_id, quantity, line, mold_id, status = "Pending", creator_user_id = null, creator_name = null } = req.body;
    const { rows } = await pool.query(
      `UPDATE work_orders
       SET product_id = $1, quantity = $2, line = $3, mold_id = $4, status = $5, creator_user_id = $6, creator_name = $7, updated_at = now()
       WHERE work_order_id = $8
       RETURNING ${WORK_ORDER_COLUMNS}`,
      [product_id, quantity, line, mold_id, status, creator_user_id, creator_name, req.params.id]
    );
    if (rows.length === 0) throw createHttpError(404, "Work order not found");
    res.json(rows[0]);
  }));

  router.delete("/:id", asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `DELETE FROM work_orders WHERE work_order_id = $1 RETURNING ${WORK_ORDER_COLUMNS}`,
      [req.params.id]
    );
    if (rows.length === 0) throw createHttpError(404, "Work order not found");
    res.json(rows[0]);
  }));

  /**
   * POST /api/work-orders/:id/start
   * Transition: Pending -> In_Progress
   * No stock/mold changes.
   */
  router.post("/:id/start", asyncRoute(async (req, res) => {
    const workOrderId = req.params.id;

    const txFn = pool.withTransaction
      ? (cb) => pool.withTransaction(cb)
      : (cb) => withTransaction(pool, cb);

    const workOrder = await txFn(async (client) => {
      // 1. Lock Work Order row
      const woResult = await client.query(
        `SELECT work_order_id, status, mold_id, product_id, quantity, line, creator_user_id, creator_name, created_at, updated_at
         FROM work_orders WHERE work_order_id = $1 FOR UPDATE`,
        [workOrderId]
      );
      if (woResult.rows.length === 0) throw createHttpError(404, "Work order not found");

      const wo = woResult.rows[0];

      // 2. Validate state transition
      if (wo.status !== "Pending") {
        throw createHttpError(409, `Cannot start work order: current status is '${wo.status}', expected 'Pending'`);
      }

      // 3. Update status
      const updateResult = await client.query(
        `UPDATE work_orders SET status = 'In_Progress', updated_at = now()
         WHERE work_order_id = $1
         RETURNING ${WORK_ORDER_COLUMNS}`,
        [workOrderId]
      );

      // 4. Insert System Log
      await client.query(
        `INSERT INTO system_logs (level, message, work_order_id, created_by_user_id)
         VALUES ($1, $2, $3, $4)`,
        ["INFO", `Work order ${workOrderId} started (Pending -> In_Progress)`, workOrderId, wo.creator_user_id]
      );

      return updateResult.rows[0];
    });

    res.json(workOrder);
  }));

  /**
   * POST /api/work-orders/:id/complete
   * Transition: Pending or In_Progress -> Completed
   * Releases Mold (status -> Idle). No stock changes.
   */
  router.post("/:id/complete", asyncRoute(async (req, res) => {
    const workOrderId = req.params.id;

    const txFn = pool.withTransaction
      ? (cb) => pool.withTransaction(cb)
      : (cb) => withTransaction(pool, cb);

    const workOrder = await txFn(async (client) => {
      // 1. Lock Work Order row
      const woResult = await client.query(
        `SELECT work_order_id, status, mold_id, product_id, quantity, line, creator_user_id, creator_name, created_at, updated_at
         FROM work_orders WHERE work_order_id = $1 FOR UPDATE`,
        [workOrderId]
      );
      if (woResult.rows.length === 0) throw createHttpError(404, "Work order not found");

      const wo = woResult.rows[0];

      // 2. Validate state transition
      if (wo.status !== "Pending" && wo.status !== "In_Progress") {
        throw createHttpError(409, `Cannot complete work order: current status is '${wo.status}', expected 'Pending' or 'In_Progress'`);
      }

      // 3. Lock Mold FOR UPDATE
      await client.query(
        "SELECT mold_id, status FROM molds WHERE mold_id = $1 FOR UPDATE",
        [wo.mold_id]
      );

      // 4. Release Mold (Idle)
      await client.query(
        "UPDATE molds SET status = 'Idle', product_id = NULL, updated_at = now() WHERE mold_id = $1",
        [wo.mold_id]
      );

      // 5. Update Work Order status
      const updateResult = await client.query(
        `UPDATE work_orders SET status = 'Completed', updated_at = now()
         WHERE work_order_id = $1
         RETURNING ${WORK_ORDER_COLUMNS}`,
        [workOrderId]
      );

      // 6. Insert System Log
      await client.query(
        `INSERT INTO system_logs (level, message, work_order_id, created_by_user_id)
         VALUES ($1, $2, $3, $4)`,
        ["INFO", `Work order ${workOrderId} completed (${wo.status} -> Completed)`, workOrderId, wo.creator_user_id]
      );

      return updateResult.rows[0];
    });

    res.json(workOrder);
  }));

  /**
   * POST /api/work-orders/:id/reject
   * Transition: Pending or In_Progress -> Rejected
   * Reverses inventory: refund materials (restock), deduct product stock,
   * inserts inventory_transactions refund records, releases Mold (Idle).
   */
  router.post("/:id/reject", asyncRoute(async (req, res) => {
    const workOrderId = req.params.id;

    const txFn = pool.withTransaction
      ? (cb) => pool.withTransaction(cb)
      : (cb) => withTransaction(pool, cb);

    const workOrder = await txFn(async (client) => {
      // 1. Lock Work Order row
      const woResult = await client.query(
        `SELECT work_order_id, status, mold_id, product_id, quantity, line, creator_user_id, creator_name, created_at, updated_at
         FROM work_orders WHERE work_order_id = $1 FOR UPDATE`,
        [workOrderId]
      );
      if (woResult.rows.length === 0) throw createHttpError(404, "Work order not found");

      const wo = woResult.rows[0];

      // 2. Validate state transition
      if (wo.status !== "Pending" && wo.status !== "In_Progress") {
        throw createHttpError(409, `Cannot reject work order: current status is '${wo.status}', expected 'Pending' or 'In_Progress'`);
      }

      // 3. Get BOM items for this product
      const bomResult = await client.query(
        "SELECT material_id, amount_per_unit FROM bom_table WHERE product_id = $1 ORDER BY material_id",
        [wo.product_id]
      );
      const bomItems = bomResult.rows;

      // 4. Lock Materials FOR UPDATE (ordered by material_id to avoid deadlocks)
      const materialIds = bomItems.map((b) => b.material_id);
      if (materialIds.length > 0) {
        await client.query(
          "SELECT material_id, stock FROM materials WHERE material_id = ANY($1) ORDER BY material_id FOR UPDATE",
          [materialIds]
        );
      }

      // 5. Lock Product FOR UPDATE
      await client.query(
        "SELECT product_id, stock FROM products WHERE product_id = $1 FOR UPDATE",
        [wo.product_id]
      );

      // 6. Lock Mold FOR UPDATE
      await client.query(
        "SELECT mold_id, status FROM molds WHERE mold_id = $1 FOR UPDATE",
        [wo.mold_id]
      );

      // 7. Refund Material stock & insert inventory_transactions (restock)
      for (const bomItem of bomItems) {
        const refundQty = Number(bomItem.amount_per_unit) * Number(wo.quantity);

        await client.query(
          "UPDATE materials SET stock = stock + $1, updated_at = now() WHERE material_id = $2",
          [refundQty, bomItem.material_id]
        );

        // transaction_type 'restock' is allowed per schema CHECK constraint
        await client.query(
          `INSERT INTO inventory_transactions (work_order_id, material_id, product_id, transaction_type, quantity, created_by_user_id)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [workOrderId, bomItem.material_id, wo.product_id, "restock", refundQty, wo.creator_user_id]
        );
      }

      // 8. Deduct Product stock
      await client.query(
        "UPDATE products SET stock = stock - $1, updated_at = now() WHERE product_id = $2",
        [wo.quantity, wo.product_id]
      );

      // 9. Release Mold (Idle)
      await client.query(
        "UPDATE molds SET status = 'Idle', product_id = NULL, updated_at = now() WHERE mold_id = $1",
        [wo.mold_id]
      );

      // 10. Update Work Order status
      const updateResult = await client.query(
        `UPDATE work_orders SET status = 'Rejected', updated_at = now()
         WHERE work_order_id = $1
         RETURNING ${WORK_ORDER_COLUMNS}`,
        [workOrderId]
      );

      // 11. Insert System Log
      await client.query(
        `INSERT INTO system_logs (level, message, work_order_id, created_by_user_id)
         VALUES ($1, $2, $3, $4)`,
        ["INFO", `Work order ${workOrderId} rejected (${wo.status} -> Rejected); materials restocked`, workOrderId, wo.creator_user_id]
      );

      return updateResult.rows[0];
    });

    res.json(workOrder);
  }));

  return router;
};
