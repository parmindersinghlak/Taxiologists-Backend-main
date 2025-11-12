function notFound(req, res, next) {
  res
    .status(404)
    .json({ success: false, code: "NOT_FOUND", message: "Route not found" });
}

function errorHandler(err, req, res, next) {
  // eslint-disable-line
  const status = err.status || 500;
  const code = err.code || "INTERNAL_ERROR";
  const message = err.message || "Internal server error";
  res.status(status).json({ success: false, code, message });
}

module.exports = { notFound, errorHandler };
