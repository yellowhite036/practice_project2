const jwt = require("jsonwebtoken");
const { createHttpError } = require("./errorHandler");

function requireAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw createHttpError(401, "Authorization header missing or invalid");
    }

    const token = authHeader.split(" ")[1];
    if (!token) {
      throw createHttpError(401, "Bearer token not found");
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw createHttpError(401, "Invalid token");
    }

    const payload = jwt.verify(token, secret);
    
    if (!payload.user_id || !payload.role) {
      throw createHttpError(401, "Invalid token payload");
    }

    req.user = {
      user_id: payload.user_id,
      role: payload.role
    };

    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      next(createHttpError(401, "Token expired"));
    } else if (err.name === "JsonWebTokenError" || err.name === "NotBeforeError") {
      next(createHttpError(401, "Invalid token"));
    } else {
      next(err);
    }
  }
}

function requireRole(allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(createHttpError(401, "Unauthorized"));
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      return next(createHttpError(403, "Forbidden"));
    }
    
    next();
  };
}

module.exports = {
  requireAuth,
  requireRole
};
