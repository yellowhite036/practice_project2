const { Router } = require("express");
const { createHttpError } = require("../middleware/errorHandler");
const { requireAuth, requireRole } = require("../middleware/auth");

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const COLUMNS = "id, name, is_active, created_at, updated_at";

function lineName(value) {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name && name.length <= 100 ? name : null;
}

module.exports = function createLinesRouter(pool) {
  const router = Router();
  const readers = ["admin", "manager", "operator"];
  const writers = ["admin", "manager"];

  router.get("/", requireAuth, requireRole(readers), asyncRoute(async (req, res) => {
    const includeInactive = req.query.include_inactive === "true";
    const { rows } = await pool.query(
      `SELECT ${COLUMNS} FROM production_lines ${includeInactive ? "" : "WHERE is_active = TRUE"} ORDER BY name`
    );
    res.json(rows);
  }));

  router.post("/", requireAuth, requireRole(writers), asyncRoute(async (req, res) => {
    const name = lineName(req.body.name);
    if (!name) throw createHttpError(400, "name is required and must be at most 100 characters");
    const { rows } = await pool.query(
      `INSERT INTO production_lines(line_id, name) VALUES ($1, $1) RETURNING ${COLUMNS}`,
      [name]
    );
    res.status(201).json(rows[0]);
  }));

  router.patch("/:id", requireAuth, requireRole(writers), asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw createHttpError(400, "line id must be a positive integer");
    const hasName = Object.prototype.hasOwnProperty.call(req.body, "name");
    const hasActive = Object.prototype.hasOwnProperty.call(req.body, "is_active");
    if (!hasName && !hasActive) throw createHttpError(400, "name or is_active is required");
    const name = hasName ? lineName(req.body.name) : null;
    if (hasName && !name) throw createHttpError(400, "name is required and must be at most 100 characters");
    if (hasActive && typeof req.body.is_active !== "boolean") throw createHttpError(400, "is_active must be boolean");
    const { rows } = await pool.query(
      `UPDATE production_lines SET name = COALESCE($1, name), is_active = COALESCE($2, is_active), updated_at = now()
       WHERE id = $3 RETURNING ${COLUMNS}`,
      [name, hasActive ? req.body.is_active : null, id]
    );
    if (!rows[0]) throw createHttpError(404, "Production line not found");
    res.json(rows[0]);
  }));

  router.delete("/:id", requireAuth, requireRole(writers), asyncRoute(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) throw createHttpError(400, "line id must be a positive integer");
    const { rows } = await pool.query(
      `UPDATE production_lines SET is_active = FALSE, updated_at = now() WHERE id = $1 AND is_active = TRUE RETURNING ${COLUMNS}`,
      [id]
    );
    if (!rows[0]) throw createHttpError(404, "Production line not found or already inactive");
    res.json({ deleted: true, line: rows[0] });
  }));
  return router;
};
