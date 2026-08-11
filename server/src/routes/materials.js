const { Router } = require("express");
const { createHttpError } = require("../middleware/errorHandler");

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

function validateMaterial(body) {
  if (!body.name) return "name is required";
  if (!body.unit) return "unit is required";
  if (body.stock !== undefined && Number(body.stock) < 0) return "stock must be greater than or equal to 0";
  if (body.capacity !== undefined && body.capacity !== null && Number(body.capacity) < 0) return "capacity must be greater than or equal to 0";
  if (body.safety_stock !== undefined && Number(body.safety_stock) < 0) return "safety_stock must be greater than or equal to 0";
  return null;
}

module.exports = function createMaterialsRouter(pool) {
  const router = Router();

  router.get("/", asyncRoute(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM materials ORDER BY material_id");
    res.json(rows);
  }));

  router.get("/:id", asyncRoute(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM materials WHERE material_id = $1", [req.params.id]);
    if (rows.length === 0) throw createHttpError(404, "Material not found");
    res.json(rows[0]);
  }));

  router.post("/", asyncRoute(async (req, res) => {
    const error = validateMaterial(req.body);
    if (error) throw createHttpError(400, error);

    const { material_id, name, unit, stock = 0, capacity = null, safety_stock = 0, location = null } = req.body;
    if (!material_id) throw createHttpError(400, "material_id is required");

    const { rows } = await pool.query(
      `INSERT INTO materials (material_id, name, unit, stock, capacity, safety_stock, location)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [material_id, name, unit, stock, capacity, safety_stock, location]
    );
    res.status(201).json(rows[0]);
  }));

  router.put("/:id", asyncRoute(async (req, res) => {
    const error = validateMaterial(req.body);
    if (error) throw createHttpError(400, error);

    const { name, unit, stock = 0, capacity = null, safety_stock = 0, location = null } = req.body;
    const { rows } = await pool.query(
      `UPDATE materials
       SET name = $1, unit = $2, stock = $3, capacity = $4, safety_stock = $5, location = $6, updated_at = now()
       WHERE material_id = $7
       RETURNING *`,
      [name, unit, stock, capacity, safety_stock, location, req.params.id]
    );
    if (rows.length === 0) throw createHttpError(404, "Material not found");
    res.json(rows[0]);
  }));

  router.delete("/:id", asyncRoute(async (req, res) => {
    const { rows } = await pool.query("DELETE FROM materials WHERE material_id = $1 RETURNING *", [req.params.id]);
    if (rows.length === 0) throw createHttpError(404, "Material not found");
    res.status(204).end();
  }));

  return router;
};
