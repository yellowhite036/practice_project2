const { Router } = require("express");
const jwt = require("jsonwebtoken");
const { createHttpError } = require("../middleware/errorHandler");

const asyncRoute = (handler) => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

module.exports = function createAuthRouter(pool) {
  const router = Router();

  router.post("/login", asyncRoute(async (req, res) => {
    const { user_id } = req.body;
    if (!user_id) {
      throw createHttpError(400, "user_id is required");
    }

    const { rows } = await pool.query("SELECT user_id, role FROM users WHERE user_id = $1", [user_id]);
    if (rows.length === 0) {
      throw createHttpError(401, "Unauthorized");
    }

    const user = rows[0];
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw createHttpError(500, "JWT secret not configured");
    }

    const token = jwt.sign(
      { user_id: user.user_id, role: user.role },
      secret,
      { expiresIn: "8h" }
    );

    res.json({
      token,
      user
    });
  }));

  return router;
};
