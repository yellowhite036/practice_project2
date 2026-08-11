const { Router } = require("express");
const { createHttpError } = require("../middleware/errorHandler");

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const LOG_COLUMNS = `
  log_id,
  level,
  message,
  work_order_id,
  created_by_user_id,
  created_at
`;

module.exports = function createLogsRouter(pool) {
  const router = Router();

  router.get("/", asyncRoute(async (req, res) => {
    const { rows } = await pool.query(`SELECT ${LOG_COLUMNS} FROM system_logs ORDER BY created_at DESC, log_id DESC`);
    res.json(rows);
  }));

  router.get("/:id", asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT ${LOG_COLUMNS} FROM system_logs WHERE log_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) throw createHttpError(404, "Log not found");
    res.json(rows[0]);
  }));

  return router;
};
