const { Router } = require("express");
const { createHttpError } = require("../middleware/errorHandler");
const { requireAuth, requireRole } = require("../middleware/auth");
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
  if (!body.work_order_id) {
    return "work_order_id is required";
  }

  if (!body.product_id) {
    return "product_id is required";
  }

  if (
    body.quantity === undefined ||
    Number(body.quantity) <= 0
  ) {
    return "quantity must be greater than 0";
  }

  if (!body.line) {
    return "line is required";
  }

  if (!body.mold_id) {
    return "mold_id is required";
  }

  return null;
}

module.exports = function createWorkOrdersRouter(pool) {
  const router = Router();

  const tx = (callback) => {
    if (typeof pool.withTransaction === "function") {
      return pool.withTransaction(callback);
    }

    return withTransaction(pool, callback);
  };

  /*
   * Shared action: Pending -> In_Progress
   * 不修改 Material、Product、Mold。
   */
  async function startWorkOrder(workOrderId) {
    return tx(async (client) => {
      /*
       * 1. Lock Work Order
       */
      const woResult = await client.query(
        `SELECT ${WORK_ORDER_COLUMNS}
         FROM work_orders
         WHERE work_order_id = $1
         FOR UPDATE`,
        [workOrderId]
      );

      if (woResult.rows.length === 0) {
        throw createHttpError(404, "Work order not found");
      }

      const wo = woResult.rows[0];

      /*
       * 2. Validate state transition
       */
      if (wo.status !== "Pending") {
        throw createHttpError(
          409,
          `Cannot start work order: current status is '${wo.status}', expected 'Pending'`
        );
      }

      /*
       * 3. Update status
       */
      const updateResult = await client.query(
        `UPDATE work_orders
         SET status = 'In_Progress',
             updated_at = now()
         WHERE work_order_id = $1
         RETURNING ${WORK_ORDER_COLUMNS}`,
        [workOrderId]
      );

      /*
       * 4. System Log
       */
      await client.query(
        `INSERT INTO system_logs (
           level,
           message,
           work_order_id,
           created_by_user_id
         )
         VALUES ($1, $2, $3, $4)`,
        [
          "INFO",
          `Work order ${workOrderId} started (Pending -> In_Progress)`,
          workOrderId,
          wo.creator_user_id
        ]
      );

      return updateResult.rows[0];
    });
  }

  /*
   * Shared action: Pending / In_Progress -> Completed
   * Mold -> Idle
   * Product stock 在完工時才增加。
   */
  async function completeWorkOrder(workOrderId) {
    return tx(async (client) => {
      /*
       * 1. Lock Work Order
       */
      const woResult = await client.query(
        `SELECT ${WORK_ORDER_COLUMNS}
         FROM work_orders
         WHERE work_order_id = $1
         FOR UPDATE`,
        [workOrderId]
      );

      if (woResult.rows.length === 0) {
        throw createHttpError(404, "Work order not found");
      }

      const wo = woResult.rows[0];

      /*
       * 2. Validate state transition
       */
      if (
        wo.status !== "Pending" &&
        wo.status !== "In_Progress"
      ) {
        throw createHttpError(
          409,
          `Cannot complete work order: current status is '${wo.status}', expected 'Pending' or 'In_Progress'`
        );
      }

      /*
       * 3. Lock Mold
       */
      const moldResult = await client.query(
        `SELECT mold_id, status
         FROM molds
         WHERE mold_id = $1
         FOR UPDATE`,
        [wo.mold_id]
      );

      if (moldResult.rows.length === 0) {
        throw createHttpError(400, "Mold not found");
      }

      /*
       * 4. Release Mold
       */
      await client.query(
        `UPDATE molds
         SET status = 'Idle',
             product_id = NULL,
             updated_at = now()
         WHERE mold_id = $1`,
        [wo.mold_id]
      );

      /*
       * 5. Lock Product & increase stock
       */
      const productResult = await client.query(
        `SELECT product_id, stock
         FROM products
         WHERE product_id = $1
         FOR UPDATE`,
        [wo.product_id]
      );

      if (productResult.rows.length === 0) {
        throw createHttpError(400, "Product not found");
      }

      await client.query(
        `UPDATE products
         SET stock = stock + $1,
             updated_at = now()
         WHERE product_id = $2`,
        [wo.quantity, wo.product_id]
      );

      /*
       * 6. Insert produce transaction
       */
      await client.query(
        `INSERT INTO inventory_transactions (
           work_order_id,
           material_id,
           product_id,
           transaction_type,
           quantity,
           created_by_user_id
         )
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          workOrderId,
          null,
          wo.product_id,
          "produce",
          wo.quantity,
          wo.creator_user_id
        ]
      );

      /*
       * 7. Update Work Order
       */
      const updateResult = await client.query(
        `UPDATE work_orders
         SET status = 'Completed',
             updated_at = now()
         WHERE work_order_id = $1
         RETURNING ${WORK_ORDER_COLUMNS}`,
        [workOrderId]
      );

      /*
       * 8. System Log
       */
      await client.query(
        `INSERT INTO system_logs (
           level,
           message,
           work_order_id,
           created_by_user_id
         )
         VALUES ($1, $2, $3, $4)`,
        [
          "INFO",
          `Work order ${workOrderId} completed (${wo.status} -> Completed)`,
          workOrderId,
          wo.creator_user_id
        ]
      );

      return updateResult.rows[0];
    });
  }

  /*
   * Shared action: Pending / In_Progress -> Rejected
   *
   * Reverse:
   * - Material stock + required quantity
   * - Inventory transaction = restock
   * - Mold -> Idle
   *
   * 注意：Product stock 只在 complete 時才會增加，
   * 所以 reject 不需要（也不應該）反向扣減 product stock。
   */
  async function rejectWorkOrder(workOrderId) {
    return tx(async (client) => {
      /*
       * 1. Lock Work Order
       */
      const woResult = await client.query(
        `SELECT ${WORK_ORDER_COLUMNS}
         FROM work_orders
         WHERE work_order_id = $1
         FOR UPDATE`,
        [workOrderId]
      );

      if (woResult.rows.length === 0) {
        throw createHttpError(404, "Work order not found");
      }

      const wo = woResult.rows[0];

      /*
       * 2. Validate state transition
       */
      if (
        wo.status !== "Pending" &&
        wo.status !== "In_Progress"
      ) {
        throw createHttpError(
          409,
          `Cannot reject work order: current status is '${wo.status}', expected 'Pending' or 'In_Progress'`
        );
      }

      /*
       * 3. Get BOM
       */
      const bomResult = await client.query(
        `SELECT material_id, amount_per_unit
         FROM bom_table
         WHERE product_id = $1
         ORDER BY material_id`,
        [wo.product_id]
      );

      const bomItems = bomResult.rows;

      /*
       * 4. Lock Materials
       */
      const materialIds = bomItems.map((item) => item.material_id);

      let lockedMaterials = [];

      if (materialIds.length > 0) {
        const materialResult = await client.query(
          `SELECT material_id, stock
           FROM materials
           WHERE material_id = ANY($1)
           ORDER BY material_id
           FOR UPDATE`,
          [materialIds]
        );

        lockedMaterials = materialResult.rows;

        for (const materialId of materialIds) {
          const materialExists = lockedMaterials.some(
            (item) => item.material_id === materialId
          );

          if (!materialExists) {
            throw createHttpError(
              400,
              `Material ${materialId} not found`
            );
          }
        }
      }

      /*
       * 5. Lock Mold
       */
      const moldResult = await client.query(
        `SELECT mold_id, status
         FROM molds
         WHERE mold_id = $1
         FOR UPDATE`,
        [wo.mold_id]
      );

      if (moldResult.rows.length === 0) {
        throw createHttpError(400, "Mold not found");
      }

      /*
       * 6. Refund Materials
       */
      for (const bomItem of bomItems) {
        const refundQty =
          Number(bomItem.amount_per_unit) * Number(wo.quantity);

        await client.query(
          `UPDATE materials
           SET stock = stock + $1,
               updated_at = now()
           WHERE material_id = $2`,
          [refundQty, bomItem.material_id]
        );

        await client.query(
          `INSERT INTO inventory_transactions (
             work_order_id,
             material_id,
             product_id,
             transaction_type,
             quantity,
             created_by_user_id
           )
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            workOrderId,
            bomItem.material_id,
            wo.product_id,
            "restock",
            refundQty,
            wo.creator_user_id
          ]
        );
      }

      /*
       * 7. Release Mold
       */
      await client.query(
        `UPDATE molds
         SET status = 'Idle',
             product_id = NULL,
             updated_at = now()
         WHERE mold_id = $1`,
        [wo.mold_id]
      );

      /*
       * 8. Update Work Order
       */
      const updateResult = await client.query(
        `UPDATE work_orders
         SET status = 'Rejected',
             updated_at = now()
         WHERE work_order_id = $1
         RETURNING ${WORK_ORDER_COLUMNS}`,
        [workOrderId]
      );

      /*
       * 9. System Log
       */
      await client.query(
        `INSERT INTO system_logs (
           level,
           message,
           work_order_id,
           created_by_user_id
         )
         VALUES ($1, $2, $3, $4)`,
        [
          "INFO",
          `Work order ${workOrderId} rejected (${wo.status} -> Rejected); materials restocked`,
          workOrderId,
          wo.creator_user_id
        ]
      );

      return updateResult.rows[0];
    });
  }

  /*
   * GET /api/work-orders
   */
  router.get(
    "/",
    requireAuth,
    requireRole(["admin", "manager", "operator"]),
    asyncRoute(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT ${WORK_ORDER_COLUMNS}
         FROM work_orders
         ORDER BY created_at DESC, work_order_id DESC`
      );

      res.json(rows);
    })
  );

  /*
   * GET /api/work-orders/:id
   */
  router.get(
    "/:id",
    requireAuth,
    requireRole(["admin", "manager", "operator"]),
    asyncRoute(async (req, res) => {
      const { rows } = await pool.query(
        `SELECT ${WORK_ORDER_COLUMNS}
         FROM work_orders
         WHERE work_order_id = $1`,
        [req.params.id]
      );

      if (rows.length === 0) {
        throw createHttpError(404, "Work order not found");
      }

      res.json(rows[0]);
    })
  );

  /*
   * POST /api/work-orders
   *
   * Transaction:
   * 1. Validate Product
   * 2. Get BOM
   * 3. Lock Materials
   * 4. Check Material stock
   * 5. Lock Mold
   * 6. Check Mold status
   * 7. Insert Work Order
   * 8. Deduct Material stock
   * 9. Insert consume transactions (負數，代表庫存流出)
   * 10. Set Mold -> In_Use
   * 11. Insert System Log
   *
   * 注意：Product stock 不在建立時增加，
   * 而是在 /complete（或 PUT + action=complete）時才增加。
   */
  router.post(
    "/",
    requireAuth,
    requireRole(["admin", "manager"]),
    asyncRoute(async (req, res) => {
      const validationError = validateWorkOrder(req.body);

      if (validationError) {
        throw createHttpError(400, validationError);
      }

      const {
        work_order_id,
        product_id,
        quantity,
        line,
        mold_id,
        creator_user_id = null,
        creator_name = null
      } = req.body;

      const workOrder = await tx(async (client) => {
        /*
         * 1. Validate Product
         */
        const productResult = await client.query(
          `SELECT product_id, stock
           FROM products
           WHERE product_id = $1`,
          [product_id]
        );

        if (productResult.rows.length === 0) {
          throw createHttpError(400, "Product not found");
        }

        /*
         * 2. Get BOM
         */
        const bomResult = await client.query(
          `SELECT material_id, amount_per_unit
           FROM bom_table
           WHERE product_id = $1
           ORDER BY material_id`,
          [product_id]
        );

        const bomItems = bomResult.rows;

        /*
         * 3. Lock Materials
         *
         * 按 material_id 排序取得鎖，
         * 降低多個 Transaction 發生 deadlock 的機率。
         */
        const materialIds = bomItems.map((item) => item.material_id);

        let lockedMaterials = [];

        if (materialIds.length > 0) {
          const lockResult = await client.query(
            `SELECT material_id, stock
             FROM materials
             WHERE material_id = ANY($1)
             ORDER BY material_id
             FOR UPDATE`,
            [materialIds]
          );

          lockedMaterials = lockResult.rows;
        }

        /*
         * 4. Check Material stock
         */
        for (const bomItem of bomItems) {
          const required =
            Number(bomItem.amount_per_unit) * Number(quantity);

          const material = lockedMaterials.find(
            (item) => item.material_id === bomItem.material_id
          );

          if (!material) {
            throw createHttpError(
              400,
              `Material ${bomItem.material_id} not found`
            );
          }

          const currentStock = Number(material.stock);

          if (currentStock < required) {
            throw createHttpError(
              409,
              `Insufficient stock for material ${bomItem.material_id}`
            );
          }
        }

        /*
         * 5. Lock Mold
         */
        const moldResult = await client.query(
          `SELECT mold_id, status
           FROM molds
           WHERE mold_id = $1
           FOR UPDATE`,
          [mold_id]
        );

        if (moldResult.rows.length === 0) {
          throw createHttpError(400, "Mold not found");
        }

        /*
         * 6. Check Mold status
         */
        if (moldResult.rows[0].status !== "Idle") {
          throw createHttpError(409, "Mold is currently in use");
        }

        /*
         * 7. Insert Work Order
         *
         * inventory_transactions.work_order_id
         * FK -> work_orders.work_order_id
         *
         * 因此 Work Order 先建立。
         */
        const woResult = await client.query(
          `INSERT INTO work_orders (
             work_order_id,
             product_id,
             quantity,
             line,
             mold_id,
             status,
             creator_user_id,
             creator_name
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING ${WORK_ORDER_COLUMNS}`,
          [
            work_order_id,
            product_id,
            quantity,
            line,
            mold_id,
            "Pending",
            creator_user_id,
            creator_name
          ]
        );

        /*
         * 8. Deduct Material stock
         * 9. Insert consume transactions（庫存流出記為負數）
         */
        for (const bomItem of bomItems) {
          const required =
            Number(bomItem.amount_per_unit) * Number(quantity);

          await client.query(
            `UPDATE materials
            SET stock = stock - $1,
                updated_at = now()
            WHERE material_id = $2`,
            [required, bomItem.material_id]
          );

          await client.query(
            `INSERT INTO inventory_transactions (
              work_order_id,
              material_id,
              product_id,
              transaction_type,
              quantity,
              created_by_user_id
            )
            VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              work_order_id,
              bomItem.material_id,
              null,
              "consume",
              -required,
              creator_user_id
            ]
          );
        }

        /*
         * 10. Update Mold -> In_Use
         */
        await client.query(
          `UPDATE molds
           SET status = 'In_Use',
               product_id = $1,
               updated_at = now()
           WHERE mold_id = $2`,
          [product_id, mold_id]
        );

        /*
         * 11. Insert System Log
         */
        await client.query(
          `INSERT INTO system_logs (
             level,
             message,
             work_order_id,
             created_by_user_id
           )
           VALUES ($1, $2, $3, $4)`,
          [
            "INFO",
            `Work order ${work_order_id} created for product ${product_id}`,
            work_order_id,
            creator_user_id
          ]
        );

        return woResult.rows[0];
      });

      res.status(201).json(workOrder);
    })
  );

  /*
   * PUT /api/work-orders/:id
   *
   * 支援兩種用法：
   * 1. { action: "start" | "complete" | "reject" } -> 呼叫對應的狀態轉換邏輯
   * 2. 沒有 action -> 走整筆欄位覆寫（原本的行為）
   */
  router.put(
    "/:id",
    requireAuth,
    requireRole(["admin", "manager", "operator"]),
    asyncRoute(async (req, res) => {
      const { action } = req.body;

      if (action === "start") {
        const workOrder = await startWorkOrder(req.params.id);
        return res.json(workOrder);
      }

      if (action === "complete") {
        const workOrder = await completeWorkOrder(req.params.id);
        return res.json(workOrder);
      }

      if (action === "reject") {
        // reject 權限比 start/complete 嚴格，僅限 admin/manager
        if (!["admin", "manager"].includes(req.user?.role)) {
          throw createHttpError(
            403,
            "Only admin or manager can reject a work order"
          );
        }

        const workOrder = await rejectWorkOrder(req.params.id);
        return res.json(workOrder);
      }

      if (action) {
        throw createHttpError(400, `Unknown action '${action}'`);
      }

      /*
       * 沒有 action：原本的整筆欄位覆寫邏輯
       */
      const bodyForValidation = {
        ...req.body,
        work_order_id: req.params.id
      };

      const validationError = validateWorkOrder(bodyForValidation);

      if (validationError) {
        throw createHttpError(400, validationError);
      }

      const {
        product_id,
        quantity,
        line,
        mold_id,
        status = "Pending",
        creator_user_id = null,
        creator_name = null
      } = req.body;

      const { rows } = await pool.query(
        `UPDATE work_orders
         SET product_id = $1,
             quantity = $2,
             line = $3,
             mold_id = $4,
             status = $5,
             creator_user_id = $6,
             creator_name = $7,
             updated_at = now()
         WHERE work_order_id = $8
         RETURNING ${WORK_ORDER_COLUMNS}`,
        [
          product_id,
          quantity,
          line,
          mold_id,
          status,
          creator_user_id,
          creator_name,
          req.params.id
        ]
      );

      if (rows.length === 0) {
        throw createHttpError(404, "Work order not found");
      }

      res.json(rows[0]);
    })
  );

  /*
   * DELETE /api/work-orders/:id
   */
  router.delete(
    "/:id",
    requireAuth,
    requireRole(["admin", "manager"]),
    asyncRoute(async (req, res) => {
      const { rows } = await pool.query(
        `DELETE FROM work_orders
         WHERE work_order_id = $1
         RETURNING ${WORK_ORDER_COLUMNS}`,
        [req.params.id]
      );

      if (rows.length === 0) {
        throw createHttpError(404, "Work order not found");
      }

      res.json(rows[0]);
    })
  );

  /*
   * POST /api/work-orders/:id/start
   */
  router.post(
    "/:id/start",
    requireAuth,
    requireRole(["admin", "manager", "operator"]),
    asyncRoute(async (req, res) => {
      const workOrder = await startWorkOrder(req.params.id);
      res.json(workOrder);
    })
  );

  /*
   * POST /api/work-orders/:id/complete
   */
  router.post(
    "/:id/complete",
    requireAuth,
    requireRole(["admin", "manager", "operator"]),
    asyncRoute(async (req, res) => {
      const workOrder = await completeWorkOrder(req.params.id);
      res.json(workOrder);
    })
  );

  /*
   * POST /api/work-orders/:id/reject
   */
  router.post(
    "/:id/reject",
    requireAuth,
    requireRole(["admin", "manager"]),
    asyncRoute(async (req, res) => {
      const workOrder = await rejectWorkOrder(req.params.id);
      res.json(workOrder);
    })
  );

  return router;
};