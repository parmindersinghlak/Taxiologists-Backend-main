const jwt = require("jsonwebtoken");
const { ROLES } = require("../utils/constants");
const DriverAgreement = require('../models/DriverAgreement');

function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"] || "";

  // Try to get token from Authorization header first, then from query parameter (for SSE)
  let token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  
  // Fallback to query parameter for EventSource (SSE) which can't send custom headers
  if (!token && req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res
      .status(401)
      .json({ success: false, code: "UNAUTHORIZED", message: "Missing token" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);

    // payload is expected to be { id, role, fullName }
    req.user = payload;
    // ✅ normalize so legacy code using _id keeps working
    if (!req.user._id && req.user.id) req.user._id = req.user.id;

    next();
  } catch (e) {
    return res
      .status(401)
      .json({
        success: false,
        code: "UNAUTHORIZED",
        message: "Invalid or expired token",
      });
  }
}

function requireRole(roles) {
  const allowed = Array.isArray(roles) ? roles : [roles];
  return (req, res, next) => {
    if (!req.user || !allowed.includes(req.user.role)) {
      return res
        .status(403)
        .json({
          success: false,
          code: "FORBIDDEN",
          message: "Insufficient role",
        });
    }
    next();
  };
}

// Blocks all app features for drivers until approved.
// Agreement endpoints are mounted WITHOUT this middleware.
async function requireApprovedDriver(req, res, next) {
  try {
    if (req.user.role !== ROLES.DRIVER) return next();

    // NOTE: because we normalized _id above, either id or _id works.
    const latest = await DriverAgreement.findOne({ driver: req.user._id }).sort({ createdAt: -1 });
    const status = latest?.status || 'not_submitted';

    const approved = status === 'approved';
    if (!approved) {
      return res
        .status(403)
        .json({
          success: false,
          code: "FORBIDDEN",
          message: "Agreement not approved",
          status,
          // client can route to AgreementGate/Status page based on this payload
        });
    }
    next();
  } catch (e) {
    return res
      .status(500)
      .json({
        success: false,
        code: "SERVER_ERROR",
        message: "Access check failed"
      });
  }
}

// convenience guards
const isAdmin = requireRole(ROLES.ADMIN);
const isAdminOrManager = requireRole([ROLES.ADMIN, ROLES.MANAGER]);

module.exports = { authenticateToken, requireRole, isAdmin, isAdminOrManager, requireApprovedDriver };
