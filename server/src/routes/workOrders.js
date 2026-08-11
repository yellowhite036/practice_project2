const { Router } = require("express");
const { createHttpError } = require("../middleware/errorHandler");

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

  return router;
};
