const { Router } = require("express");
const { createHttpError } = require("../middleware/errorHandler");
const { requireAuth, requireRole } = require("../middleware/auth");

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const MOLD_COLUMNS = `
  mold_id,
  name,
  status,
  line,
  eta,
  product_id,
  code,
  mold_type,
  is_active,
  version,
  created_at,
  updated_at
`;

function validateMold(body) {
  if (typeof body.name !== "string" || !body.name.trim()) return "name is required";
  if (body.status !== undefined && !["Idle", "In_Use"].includes(body.status)) return "status must be Idle or In_Use";
  return null;
}

module.exports = function createMoldsRouter(pool) {
  const router = Router();

  router.get("/", requireAuth, requireRole(["admin", "manager", "operator"]), asyncRoute(async (req, res) => {
    const includeInactive = req.query.include_inactive === "true";
    const { rows } = await pool.query(`SELECT ${MOLD_COLUMNS} FROM molds ${includeInactive ? "" : "WHERE is_active = TRUE"} ORDER BY mold_id`);
    res.json(rows);
  }));

  router.get("/:id", requireAuth, requireRole(["admin", "manager", "operator"]), asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT ${MOLD_COLUMNS} FROM molds WHERE mold_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) throw createHttpError(404, "Mold not found");
    res.json(rows[0]);
  }));

  router.post("/", requireAuth, requireRole(["admin", "manager"]), asyncRoute(async (req, res) => {
    const error = validateMold(req.body);
    if (error) throw createHttpError(400, error);

    const { mold_id, name, status = "Idle", eta = null, product_id = null, code = null, mold_type = null } = req.body;
    if (!mold_id) throw createHttpError(400, "mold_id is required");

    const { rows } = await pool.query(
      `INSERT INTO molds (mold_id, name, status, line, eta, product_id, code, mold_type)
       VALUES ($1, $2, $3, NULL, $4, $5, $6, $7)
       RETURNING ${MOLD_COLUMNS}`,
      [mold_id, name.trim(), status, eta, product_id, code ? String(code).trim() : null, mold_type ? String(mold_type).trim() : null]
    );
    res.status(201).json(rows[0]);
  }));

  router.put("/:id", requireAuth, requireRole(["admin", "manager"]), asyncRoute(async (req, res) => {
    const error = validateMold(req.body);
    if (error) throw createHttpError(400, error);
    if (req.body.version === undefined) throw createHttpError(400, "version is required");

    const { name, status = "Idle", eta = null, product_id = null, code = null, mold_type = null, is_active = true, version } = req.body;
    const { rows } = await pool.query(
      `UPDATE molds
       SET name = $1, status = $2, line = NULL, eta = $3, product_id = $4, code = $5, mold_type = $6, is_active = $7, version = version + 1, updated_at = now()
       WHERE mold_id = $8 AND version = $9
       RETURNING ${MOLD_COLUMNS}`,
      [name.trim(), status, eta, product_id, code ? String(code).trim() : null, mold_type ? String(mold_type).trim() : null, Boolean(is_active), req.params.id, version]
    );
    if (rows.length === 0) throw createHttpError(409, "Optimistic lock conflict or resource not found");
    res.json(rows[0]);
  }));

  router.delete("/:id", requireAuth, requireRole(["admin", "manager"]), asyncRoute(async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        "UPDATE molds SET is_active = FALSE, updated_at = now() WHERE mold_id = $1 AND is_active = TRUE RETURNING mold_id",
        [req.params.id]
      );
      
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        throw createHttpError(404, "Mold not found or already inactive");
      }
      
      await client.query('COMMIT');
      res.json({ deleted: true, id: rows[0].mold_id });
    } catch (err) {
      await client.query('ROLLBACK');
      if (err.code === '23503') { // foreign_key_violation
        throw createHttpError(409, "無法刪除模具，因為此模具已有歷史工單紀錄。");
      }
      throw err;
    } finally {
      client.release();
    }
  }));

  return router;
};
