const { Router } = require("express");
const { createHttpError } = require("../middleware/errorHandler");
const { requireAuth, requireRole } = require("../middleware/auth");

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const lineId = (value) => { const id = Number(value); return Number.isInteger(id) && id > 0 ? id : null; };

module.exports = function createLineMoldsRouter(pool) {
  const router = Router();
  const readers = ["admin", "manager", "operator"];
  const writers = ["admin", "manager"];
  const select = `SELECT lmo.line_id, lmo.mold_id, m.name AS mold_name, m.code, m.mold_type, m.is_active
                  FROM line_mold_options lmo JOIN molds m ON m.mold_id = lmo.mold_id`;

  router.get("/molds", requireAuth, requireRole(readers), asyncRoute(async (req, res) => {
    const { rows } = await pool.query(`${select} ORDER BY lmo.line_id, lmo.mold_id`);
    res.json(rows);
  }));
  router.get("/:lineId/molds", requireAuth, requireRole(readers), asyncRoute(async (req, res) => {
    const id = lineId(req.params.lineId); if (!id) throw createHttpError(400, "line id must be a positive integer");
    const { rows } = await pool.query(`${select} WHERE lmo.line_id = $1 ORDER BY lmo.mold_id`, [id]);
    res.json(rows);
  }));
  router.put("/:lineId/molds", requireAuth, requireRole(writers), asyncRoute(async (req, res) => {
    const id = lineId(req.params.lineId);
    const moldIds = Array.isArray(req.body.mold_ids) ? [...new Set(req.body.mold_ids.map(String).map(value => value.trim()).filter(Boolean))] : null;
    if (!id || !moldIds) throw createHttpError(400, "valid line id and mold_ids array are required");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const line = await client.query("SELECT id FROM production_lines WHERE id = $1", [id]);
      if (!line.rows[0]) throw createHttpError(404, "Production line not found");
      if (moldIds.length) {
        const molds = await client.query("SELECT mold_id FROM molds WHERE mold_id = ANY($1) AND is_active = TRUE", [moldIds]);
        if (molds.rows.length !== moldIds.length) throw createHttpError(400, "All molds must exist and be active");
      }
      await client.query("DELETE FROM line_mold_options WHERE line_id = $1", [id]);
      for (const moldId of moldIds) await client.query(
        "INSERT INTO line_mold_options(line_id, mold_id) VALUES ($1, $2)", [id, moldId]
      );
      await client.query("COMMIT");
      res.json({ line_id: id, mold_ids: moldIds });
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }));
  return router;
};
