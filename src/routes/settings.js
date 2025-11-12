const express = require("express");
const router = express.Router();
const {
  authenticateToken,
  requireRole,
  isAdminOrManager,
  isAdmin,
} = require("../middleware/auth");
const Settings = require("../models/Settings");
const {
  getDriverReportSettings,
  updateDriverReportSettings,
  getSettingsSchema,
} = require("../services/driverReportSettingsService");
const {
  getGSTSettings,
  updateGSTSettings,
} = require("../controllers/settingsController");

// All settings routes require authentication
router.use(authenticateToken);

// ---------- GST settings ----------
router.get("/gst", isAdminOrManager, getGSTSettings);
router.put("/gst", isAdmin, updateGSTSettings);

// ---------- Driver Report Settings (admin/manager UX) ----------
/**
 * GET  /api/settings/driver-report
 * PUT  /api/settings/driver-report
 */
router.get(
  "/driver-report",
  requireRole(["admin", "manager"]),
  async (req, res, next) => {
    try {
      const settings = await getDriverReportSettings();
      const doc = await Settings.findOne({
        key: "driverReportSettings",
      }).lean();
      res.json({
        success: true,
        settings,
        lastUpdated: doc?.updatedAt ?? null,
        schema: getSettingsSchema(),
      });
    } catch (e) {
      next(e);
    }
  }
);

router.put("/driver-report", requireRole(["admin"]), async (req, res, next) => {
  try {
    const result = await updateDriverReportSettings(
      req.body || {},
      req.user.id
    );
    res.json({ success: true, ...result });
  } catch (e) {
    next(e);
  }
});

// ---------- NEW: Read-only endpoint for all authenticated users (mobile app) ----------
/**
 * GET /api/settings/driver-report/current
 * Returns only the values the mobile app needs, no special role required.
 */
router.get("/driver-report/current", async (req, res, next) => {
  try {
    const settings = await getDriverReportSettings();
    const doc = await Settings.findOne({ key: "driverReportSettings" }).lean();
    res.json({
      success: true,
      settings: {
        rentalRatePercentage: settings.rentalRatePercentage,
        tripLevyRate: settings.tripLevyRate,
      },
      lastUpdated: doc?.updatedAt ?? null,
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
