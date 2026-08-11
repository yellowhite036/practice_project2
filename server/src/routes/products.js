const { Router } = require("express");
const { createHttpError } = require("../middleware/errorHandler");

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

function validateProduct(body) {
  if (!body.name) return "name is required";
  if (body.cycle_minutes === undefined || Number(body.cycle_minutes) <= 0) return "cycle_minutes must be greater than 0";
  if (body.stock !== undefined && Number(body.stock) < 0) return "stock must be greater than or equal to 0";
  return null;
}

module.exports = function createProductsRouter(pool) {
  const router = Router();

  router.get("/", asyncRoute(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM products ORDER BY product_id");
    res.json(rows);
  }));

  router.get("/:id", asyncRoute(async (req, res) => {
    const { rows } = await pool.query("SELECT * FROM products WHERE product_id = $1", [req.params.id]);
    if (rows.length === 0) throw createHttpError(404, "Product not found");
    res.json(rows[0]);
  }));

  router.post("/", asyncRoute(async (req, res) => {
    const error = validateProduct(req.body);
    if (error) throw createHttpError(400, error);

    const { product_id, name, cycle_minutes, mold_id = null, stock = 0 } = req.body;
    if (!product_id) throw createHttpError(400, "product_id is required");

    const { rows } = await pool.query(
      `INSERT INTO products (product_id, name, cycle_minutes, mold_id, stock)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [product_id, name, cycle_minutes, mold_id, stock]
    );
    res.status(201).json(rows[0]);
  }));

  router.put("/:id", asyncRoute(async (req, res) => {
    const error = validateProduct(req.body);
    if (error) throw createHttpError(400, error);

    const { name, cycle_minutes, mold_id = null, stock = 0 } = req.body;
    const { rows } = await pool.query(
      `UPDATE products
       SET name = $1, cycle_minutes = $2, mold_id = $3, stock = $4, updated_at = now()
       WHERE product_id = $5
       RETURNING *`,
      [name, cycle_minutes, mold_id, stock, req.params.id]
    );
    if (rows.length === 0) throw createHttpError(404, "Product not found");
    res.json(rows[0]);
  }));

  router.delete("/:id", asyncRoute(async (req, res) => {
    const { rows } = await pool.query("DELETE FROM products WHERE product_id = $1 RETURNING *", [req.params.id]);
    if (rows.length === 0) throw createHttpError(404, "Product not found");
    res.status(204).end();
  }));

  return router;
};
