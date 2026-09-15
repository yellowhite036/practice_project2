const { Router } = require("express");
const { createHttpError } = require("../middleware/errorHandler");
const { requireAuth, requireRole } = require("../middleware/auth");
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

module.exports = function createItemMoldsRouter(pool) {
  const router = Router(); const readers = ["admin", "manager", "operator"]; const writers = ["admin", "manager"];
  router.get("/:productId/molds", requireAuth, requireRole(readers), asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT imo.product_id, imo.mold_id, imo.is_preferred, imo.created_at, m.name, m.code, m.is_active
       FROM item_mold_options imo JOIN molds m ON m.mold_id = imo.mold_id WHERE imo.product_id = $1 ORDER BY imo.is_preferred DESC, imo.mold_id`, [req.params.productId]);
    res.json(rows);
  }));
  router.put("/:productId/molds", requireAuth, requireRole(writers), asyncRoute(async (req, res) => {
    const productId = String(req.params.productId || "").trim();
    const moldIds = Array.isArray(req.body.mold_ids) ? [...new Set(req.body.mold_ids.map(String).map(x => x.trim()).filter(Boolean))] : null;
    const preferred = req.body.preferred_mold_id == null ? null : String(req.body.preferred_mold_id).trim();
    if (!productId || !moldIds) throw createHttpError(400, "mold_ids must be an array");
    if (preferred && !moldIds.includes(preferred)) throw createHttpError(400, "preferred_mold_id must be included in mold_ids");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const product = await client.query("SELECT product_id FROM products WHERE product_id = $1", [productId]);
      if (!product.rows[0]) throw createHttpError(404, "Product not found");
      if (moldIds.length) {
        const molds = await client.query("SELECT mold_id FROM molds WHERE mold_id = ANY($1) AND is_active = TRUE", [moldIds]);
        if (molds.rows.length !== moldIds.length) throw createHttpError(400, "All molds must exist and be active");
      }
      await client.query("DELETE FROM item_mold_options WHERE product_id = $1", [productId]);
      for (const moldId of moldIds) await client.query(
        "INSERT INTO item_mold_options(product_id, mold_id, is_preferred) VALUES ($1, $2, $3)", [productId, moldId, moldId === preferred]);
      await client.query("COMMIT");
      res.json({ product_id: productId, mold_ids: moldIds, preferred_mold_id: preferred });
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }));
  return router;
};
