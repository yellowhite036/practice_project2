const { Router } = require("express");
const { createHttpError } = require("../middleware/errorHandler");

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const BOM_COLUMNS = `
  bom_id,
  product_id,
  material_id,
  amount_per_unit,
  version,
  created_at,
  updated_at
`;

function validateBom(body) {
  if (!body.product_id) return "product_id is required";
  if (!body.material_id) return "material_id is required";
  if (body.amount_per_unit === undefined || Number(body.amount_per_unit) <= 0) return "amount_per_unit must be greater than 0";
  return null;
}

async function ensureProductAndMaterialExist(pool, productId, materialId) {
  const productResult = await pool.query("SELECT product_id FROM products WHERE product_id = $1", [productId]);
  if (productResult.rows.length === 0) throw createHttpError(400, "product_id does not exist");

  const materialResult = await pool.query("SELECT material_id FROM materials WHERE material_id = $1", [materialId]);
  if (materialResult.rows.length === 0) throw createHttpError(400, "material_id does not exist");
}

module.exports = function createBomRouter(pool) {
  const router = Router();

  router.get("/", asyncRoute(async (req, res) => {
    const { rows } = await pool.query(`SELECT ${BOM_COLUMNS} FROM bom_table ORDER BY bom_id`);
    res.json(rows);
  }));

  router.get("/product/:productId", asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT ${BOM_COLUMNS} FROM bom_table WHERE product_id = $1 ORDER BY bom_id`,
      [req.params.productId]
    );
    res.json(rows);
  }));

  router.get("/:id", asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT ${BOM_COLUMNS} FROM bom_table WHERE bom_id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) throw createHttpError(404, "BOM not found");
    res.json(rows[0]);
  }));

  router.post("/", asyncRoute(async (req, res) => {
    const error = validateBom(req.body);
    if (error) throw createHttpError(400, error);

    const { bom_id, product_id, material_id, amount_per_unit } = req.body;
    if (!bom_id) throw createHttpError(400, "bom_id is required");
    await ensureProductAndMaterialExist(pool, product_id, material_id);

    const duplicate = await pool.query(
      "SELECT bom_id FROM bom_table WHERE product_id = $1 AND material_id = $2",
      [product_id, material_id]
    );
    if (duplicate.rows.length > 0) throw createHttpError(409, "product_id and material_id already exist in BOM");

    const { rows } = await pool.query(
      `INSERT INTO bom_table (bom_id, product_id, material_id, amount_per_unit)
       VALUES ($1, $2, $3, $4)
       RETURNING ${BOM_COLUMNS}`,
      [bom_id, product_id, material_id, amount_per_unit]
    );
    res.status(201).json(rows[0]);
  }));

  router.put("/:id", asyncRoute(async (req, res) => {
    const error = validateBom(req.body);
    if (error) throw createHttpError(400, error);

    const { product_id, material_id, amount_per_unit } = req.body;
    await ensureProductAndMaterialExist(pool, product_id, material_id);

    const duplicate = await pool.query(
      "SELECT bom_id FROM bom_table WHERE product_id = $1 AND material_id = $2 AND bom_id <> $3",
      [product_id, material_id, req.params.id]
    );
    if (duplicate.rows.length > 0) throw createHttpError(409, "product_id and material_id already exist in BOM");

    const { rows } = await pool.query(
      `UPDATE bom_table
       SET product_id = $1, material_id = $2, amount_per_unit = $3, updated_at = now()
       WHERE bom_id = $4
       RETURNING ${BOM_COLUMNS}`,
      [product_id, material_id, amount_per_unit, req.params.id]
    );
    if (rows.length === 0) throw createHttpError(404, "BOM not found");
    res.json(rows[0]);
  }));

  router.delete("/:id", asyncRoute(async (req, res) => {
    const { rows } = await pool.query(
      "DELETE FROM bom_table WHERE bom_id = $1 RETURNING bom_id",
      [req.params.id]
    );
    if (rows.length === 0) throw createHttpError(404, "BOM not found");
    res.json({ deleted: true, id: rows[0].bom_id });
  }));

  return router;
};
