const { Router } = require("express");
const { createHttpError } = require("../middleware/errorHandler");
const { requireAuth, requireRole } = require("../middleware/auth");
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function lineId(value) { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; }

module.exports = function createLineRatesRouter(pool) {
  const router = Router();
  const readers = ["admin", "manager", "operator"];
  const writers = ["admin", "manager"];
  router.get("/:lineId/rates", requireAuth, requireRole(readers), asyncRoute(async (req, res) => {
    const id = lineId(req.params.lineId); if (!id) throw createHttpError(400, "line id must be a positive integer");
    const { rows } = await pool.query(
      `SELECT lir.line_id, lir.product_id, p.name AS product_name, lir.units_per_hour, lir.created_at, lir.updated_at
       FROM line_item_rates lir JOIN products p ON p.product_id = lir.product_id WHERE lir.line_id = $1 ORDER BY lir.product_id`, [id]);
    res.json(rows);
  }));
  router.put("/:lineId/rates/:productId", requireAuth, requireRole(writers), asyncRoute(async (req, res) => {
    const id = lineId(req.params.lineId); const productId = String(req.params.productId || "").trim();
    const rate = Number(req.body.units_per_hour);
    if (!id || !productId) throw createHttpError(400, "valid line id and product id are required");
    if (!Number.isFinite(rate) || rate <= 0) throw createHttpError(400, "units_per_hour must be greater than 0");
    const { rows } = await pool.query(
      `INSERT INTO line_item_rates(line_id, product_id, units_per_hour) VALUES ($1, $2, $3)
       ON CONFLICT(line_id, product_id) DO UPDATE SET units_per_hour = EXCLUDED.units_per_hour, updated_at = now()
       RETURNING line_id, product_id, units_per_hour, created_at, updated_at`, [id, productId, rate]);
    res.json(rows[0]);
  }));
  router.delete("/:lineId/rates/:productId", requireAuth, requireRole(writers), asyncRoute(async (req, res) => {
    const id = lineId(req.params.lineId); if (!id) throw createHttpError(400, "line id must be a positive integer");
    const { rows } = await pool.query("DELETE FROM line_item_rates WHERE line_id = $1 AND product_id = $2 RETURNING line_id, product_id", [id, req.params.productId]);
    if (!rows[0]) throw createHttpError(404, "Line rate not found");
    res.json({ deleted: true, ...rows[0] });
  }));
  return router;
};
