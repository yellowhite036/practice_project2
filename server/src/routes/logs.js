const { Router } = require("express");

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

  return router;
};
