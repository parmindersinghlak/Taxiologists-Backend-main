/**
 * Driver Report Routes
 * All routes related to driver report functionality
 */
const express = require("express");
const router = express.Router();
const { authenticateToken, requireRole } = require("../middleware/auth");
const { getUploadMiddleware, handleUploadError } = require("../services/photoUploadService");
const {
  listReports,            // <-- added
  createDriverReport,
  getMyReports,
  getReportById,
  updateDriverReport,
  submitReport,
  uploadReportPhoto,
  updateReportPhotoUrl,
  getPendingReports,
  reviewReport,
  deleteReport
} = require("../controllers/driverReportController");

// Apply authentication to all routes
router.use(authenticateToken);

// Admin list route MUST be before "/:reportId"
router.get("/", requireRole(["admin", "manager"]), listReports);

// Driver routes
router.post("/", requireRole(["driver"]), createDriverReport);
router.get("/my-reports", requireRole(["driver"]), getMyReports);
router.put("/:reportId", requireRole(["driver"]), updateDriverReport);
router.post("/:reportId/submit", requireRole(["driver"]), submitReport);
router.delete("/:reportId", requireRole(["driver"]), deleteReport);

// Photo upload route with multer middleware (legacy)
router.post(
  "/:reportId/photos",
  requireRole(["driver"]),
  getUploadMiddleware(),
  handleUploadError,
  uploadReportPhoto
);

// Photo URL update route for Supabase (new)
router.patch(
  "/:reportId/photos",
  requireRole(["driver"]),
  updateReportPhotoUrl
);

// Admin review routes
router.get("/admin/pending", requireRole(["admin", "manager"]), getPendingReports);
router.put("/:reportId/review", requireRole(["admin", "manager"]), reviewReport);

// Shared: view a report by public reportId
router.get("/:reportId", getReportById);

module.exports = router;
