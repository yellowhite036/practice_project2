function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function mapPostgresError(err) {
  const conflictCodes = new Set(["23505", "23503", "23514"]);
  if (conflictCodes.has(err.code)) {
    return createHttpError(409, "Database constraint conflict");
  }

  if (err.code === "23502") {
    return createHttpError(400, "Required database field is missing");
  }

  return err;
}

function notFound(req, res, next) {
  next(createHttpError(404, "Route not found"));
}

function errorHandler(err, req, res, next) {
  const safeError = mapPostgresError(err);
  const status = Number.isInteger(safeError.status) ? safeError.status : 500;
  const message = status >= 500 ? "Internal server error" : safeError.message;

  if (status >= 500) {
    console.error(err);
  }

  res.status(status).json({ error: message });
}

module.exports = {
  createHttpError,
  errorHandler,
  mapPostgresError,
  notFound
};
