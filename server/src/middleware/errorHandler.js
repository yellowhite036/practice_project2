function createHttpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function notFound(req, res, next) {
  next(createHttpError(404, "Route not found"));
}

function errorHandler(err, req, res, next) {
  const status = Number.isInteger(err.status) ? err.status : 500;
  const message = status >= 500 ? "Internal server error" : err.message;

  if (status >= 500) {
    console.error(err);
  }

  res.status(status).json({ error: message });
}

module.exports = {
  createHttpError,
  errorHandler,
  notFound
};
