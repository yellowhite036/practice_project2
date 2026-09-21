const { Router } = require("express");
const { createHttpError } = require("../middleware/errorHandler");
const { requireAuth, requireRole } = require("../middleware/auth");

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const ROUTING_COLUMNS = `
  routing_id,
  product_id,
  step_number,
  operation_name,
  cycle_minutes,
  mold_id,
  created_at,
  updated_at
`;

function validateRouting(body) {
  if (!body.product_id) return "product_id is required";
  if (body.step_number === undefined || Number(body.step_number) <= 0) return "step_number must be greater than 0";
  if (!body.operation_name) return "operation_name is required";
  if (body.cycle_minutes === undefined || Number(body.cycle_minutes) <= 0) return "cycle_minutes must be greater than 0";
  return null;
}

module.exports = function createRoutingsRouter(pool) {
  const router = Router();

  // Get all routings
  router.get("/", requireAuth, requireRole(["admin", "manager", "operator"]), asyncRoute(async (req, res) => {
    const { rows } = await pool.query(`SELECT ${ROUTING_COLUMNS} FROM product_routings ORDER BY product_id, step_number`);
    res.json(rows);
  }));

  // Get routings for a specific product
  router.get("/product/:productId", requireAuth, requireRole(["admin", "manager", "operator"]), asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT ${ROUTING_COLUMNS} FROM product_routings WHERE product_id = $1 ORDER BY step_number`,
      [req.params.productId]
    );
    res.json(rows);
  }));

  // Get a specific routing step
  router.get("/:id", requireAuth, requireRole(["admin", "manager", "operator"]), asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT ${ROUTING_COLUMNS} FROM product_routings WHERE routing_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) throw createHttpError(404, "Routing not found");
    res.json(rows[0]);
  }));

  // Create routing
  router.post("/", requireAuth, requireRole(["admin", "manager"]), asyncRoute(async (req, res) => {
    const error = validateRouting(req.body);
    if (error) throw createHttpError(400, error);

    const { routing_id, product_id, step_number, operation_name, cycle_minutes, mold_id = null } = req.body;
    if (!routing_id) throw createHttpError(400, "routing_id is required");

    // Ensure product exists
    const { rows: prodRows } = await pool.query(`SELECT 1 FROM products WHERE product_id = $1`, [product_id]);
    if (prodRows.length === 0) throw createHttpError(400, "product_id does not exist");

    const { rows } = await pool.query(
      `INSERT INTO product_routings (routing_id, product_id, step_number, operation_name, cycle_minutes, mold_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${ROUTING_COLUMNS}`,
      [routing_id, product_id, step_number, operation_name, cycle_minutes, mold_id]
    );
    res.status(201).json(rows[0]);
  }));

  // Update routing
  router.put("/:id", requireAuth, requireRole(["admin", "manager"]), asyncRoute(async (req, res) => {
    const error = validateRouting(req.body);
    if (error) throw createHttpError(400, error);

    const { product_id, step_number, operation_name, cycle_minutes, mold_id = null } = req.body;
    
    // Ensure product exists
    const { rows: prodRows } = await pool.query(`SELECT 1 FROM products WHERE product_id = $1`, [product_id]);
    if (prodRows.length === 0) throw createHttpError(400, "product_id does not exist");

    const { rows } = await pool.query(
      `UPDATE product_routings
       SET product_id = $1, step_number = $2, operation_name = $3, cycle_minutes = $4, mold_id = $5, updated_at = now()
       WHERE routing_id = $6
       RETURNING ${ROUTING_COLUMNS}`,
      [product_id, step_number, operation_name, cycle_minutes, mold_id, req.params.id]
    );
    if (rows.length === 0) throw createHttpError(404, "Routing not found");
    res.json(rows[0]);
  }));

  // Delete routing
  router.delete("/:id", requireAuth, requireRole(["admin", "manager"]), asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      "DELETE FROM product_routings WHERE routing_id = $1 RETURNING routing_id",
      [req.params.id]
    );
    if (rows.length === 0) throw createHttpError(404, "Routing not found");
    res.json({ deleted: true, id: rows[0].routing_id });
  }));

  return router;
};
