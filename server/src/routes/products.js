const { Router } = require("express");
const { createHttpError } = require("../middleware/errorHandler");
const { requireAuth, requireRole } = require("../middleware/auth");

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const PRODUCT_COLUMNS = `
  product_id,
  name,
  stock,
  version,
  created_at,
  updated_at
`;

function validateProduct(body) {
  if (!body.name) return "name is required";
  if (body.stock !== undefined && Number(body.stock) < 0) return "stock must be greater than or equal to 0";
  return null;
}

module.exports = function createProductsRouter(pool) {
  const router = Router();

  router.get("/", requireAuth, requireRole(["admin", "manager", "operator"]), asyncRoute(async (req, res) => {
    const { rows } = await pool.query(`SELECT ${PRODUCT_COLUMNS} FROM products ORDER BY product_id`);
    res.json(rows);
  }));

  router.get("/:id", requireAuth, requireRole(["admin", "manager", "operator"]), asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT ${PRODUCT_COLUMNS} FROM products WHERE product_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) throw createHttpError(404, "Product not found");
    res.json(rows[0]);
  }));

  router.post("/", requireAuth, requireRole(["admin", "manager"]), asyncRoute(async (req, res) => {
    const error = validateProduct(req.body);
    if (error) throw createHttpError(400, error);

    const { product_id, name, stock = 0 } = req.body;
    if (!product_id) throw createHttpError(400, "product_id is required");

    const { rows } = await pool.query(
      `INSERT INTO products (product_id, name, stock)
       VALUES ($1, $2, $3)
       RETURNING ${PRODUCT_COLUMNS}`,
      [product_id, name, stock]
    );
    res.status(201).json(rows[0]);
  }));

  router.put("/:id", requireAuth, requireRole(["admin", "manager"]), asyncRoute(async (req, res) => {
    const error = validateProduct(req.body);
    if (error) throw createHttpError(400, error);
    if (req.body.version === undefined) throw createHttpError(400, "version is required");

    const { name, stock = 0, version } = req.body;
    const { rows } = await pool.query(
      `UPDATE products
       SET name = $1, stock = $2, version = version + 1, updated_at = now()
       WHERE product_id = $3 AND version = $4
       RETURNING ${PRODUCT_COLUMNS}`,
      [name, stock, req.params.id, version]
    );
    if (rows.length === 0) throw createHttpError(409, "Optimistic lock conflict or resource not found");
    res.json(rows[0]);
  }));

  router.delete("/:id", requireAuth, requireRole(["admin", "manager"]), asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      "DELETE FROM products WHERE product_id = $1 RETURNING product_id",
      [req.params.id]
    );
    if (rows.length === 0) throw createHttpError(404, "Product not found");
    res.json({ deleted: true, id: rows[0].product_id });
  }));

  return router;
};
