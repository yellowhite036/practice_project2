const { Router } = require("express");
const { createHttpError } = require("../middleware/errorHandler");

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
  version,
  created_at,
  updated_at
`;

function validateMold(body) {
  if (!body.name) return "name is required";
  if (body.status !== undefined && !["Idle", "In_Use"].includes(body.status)) return "status must be Idle or In_Use";
  return null;
}

module.exports = function createMoldsRouter(pool) {
  const router = Router();

  router.get("/", asyncRoute(async (req, res) => {
    const { rows } = await pool.query(`SELECT ${MOLD_COLUMNS} FROM molds ORDER BY mold_id`);
    res.json(rows);
  }));

  router.get("/:id", asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT ${MOLD_COLUMNS} FROM molds WHERE mold_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) throw createHttpError(404, "Mold not found");
    res.json(rows[0]);
  }));

  router.post("/", asyncRoute(async (req, res) => {
    const error = validateMold(req.body);
    if (error) throw createHttpError(400, error);

    const { mold_id, name, status = "Idle", line = null, eta = null, product_id = null } = req.body;
    if (!mold_id) throw createHttpError(400, "mold_id is required");

    const { rows } = await pool.query(
      `INSERT INTO molds (mold_id, name, status, line, eta, product_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${MOLD_COLUMNS}`,
      [mold_id, name, status, line, eta, product_id]
    );
    res.status(201).json(rows[0]);
  }));

  router.put("/:id", asyncRoute(async (req, res) => {
    const error = validateMold(req.body);
    if (error) throw createHttpError(400, error);

    const { name, status = "Idle", line = null, eta = null, product_id = null } = req.body;
    const { rows } = await pool.query(
      `UPDATE molds
       SET name = $1, status = $2, line = $3, eta = $4, product_id = $5, updated_at = now()
       WHERE mold_id = $6
       RETURNING ${MOLD_COLUMNS}`,
      [name, status, line, eta, product_id, req.params.id]
    );
    if (rows.length === 0) throw createHttpError(404, "Mold not found");
    res.json(rows[0]);
  }));

  router.delete("/:id", asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      "DELETE FROM molds WHERE mold_id = $1 RETURNING mold_id",
      [req.params.id]
    );
    if (rows.length === 0) throw createHttpError(404, "Mold not found");
    res.json({ deleted: true, id: rows[0].mold_id });
  }));

  return router;
};
