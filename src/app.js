// src/app.js
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const path = require("path");
const { notFound, errorHandler } = require("./middleware/errorHandler");

const app = express();

// security & parsing
app.use(helmet());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: false }));

// CORS (leave permissive; we send Authorization header from RN)
app.use(cors());

// ✅ Make SSE logs quiet so reconnects don’t spam console
app.use(
  morgan(process.env.NODE_ENV === "production" ? "combined" : "dev", {
    skip: (req) =>
      req.path === "/api/notifications/stream" ||
      req.path === "/notifications/stream",
  })
);

// rate limit (basic)
const rateLimitWin = Number(process.env.RATE_LIMIT_WINDOW_MS || 60000);
const rateLimitMax = Number(process.env.RATE_LIMIT_MAX || 100);
const limiter = require("express-rate-limit")({
  windowMs: rateLimitWin,
  max: rateLimitMax,
});
app.use(limiter);

// ✅ Static file serving for ALL uploaded assets (driver-reports & shifts)
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
app.use(
  "/uploads/driver-reports",
  express.static(path.join(__dirname, "../uploads/driver-reports"))
);

// health
app.get("/health", (req, res) =>
  res.json({ status: "ok", env: process.env.NODE_ENV || "dev" })
);

// Import auth middleware
const { authenticateToken, requireApprovedDriver } = require("./middleware/auth");

// Routes that don't require agreement approval
app.use("/api/auth", require("./routes/auth"));
app.use("/api/users", require("./routes/users"));

// App feature routes - protected by agreement approval for drivers
app.use("/api/profile", authenticateToken, requireApprovedDriver, require("./routes/profile"));
app.use("/api/clients", authenticateToken, requireApprovedDriver, require("./routes/clients"));
app.use("/api/destinations", authenticateToken, requireApprovedDriver, require("./routes/destinations"));
app.use("/api/rides", authenticateToken, requireApprovedDriver, require("./routes/rides"));
app.use("/api/reports", authenticateToken, requireApprovedDriver, require("./routes/reports"));
app.use("/api/driver-reports", authenticateToken, requireApprovedDriver, require("./routes/driverReports"));
app.use("/api/settings", authenticateToken, requireApprovedDriver, require("./routes/settings"));
app.use("/api/notifications", authenticateToken, require("./routes/notifications"));
app.use("/api/shifts", authenticateToken, require("./routes/shifts"));
app.use("/api/agreements", require("./routes/agreements"));
app.use("/api/admin/agreements", require("./routes/adminAgreements"));

// ✅ Back-compat: stop 404 spam from old builds calling /notifications/stream
// Option A: mount the same router under /notifications
app.use("/notifications", authenticateToken, requireApprovedDriver, require("./routes/notifications"));
// Option B (alternative): redirect legacy path to the new one
// app.get("/notifications/stream", (req, res) => res.redirect(307, "/api/notifications/stream"));

// 404 + errors
app.use(notFound);
app.use(errorHandler);

module.exports = app;
