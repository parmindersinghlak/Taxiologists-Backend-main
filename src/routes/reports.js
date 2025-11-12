const router = require("express").Router();
const { authenticateToken, isAdminOrManager } = require("../middleware/auth");
const { 
  getDriverEarnings, 
  downloadDriverEarnings,
  downloadDriverEarningsExcel, 
  getMonthlyReport, 
  downloadMonthlyReport,
  downloadMonthlyReportExcel,
  getClientTrips,
  downloadClientTrips
} = require("../controllers/reportController");

// All report routes require auth and admin/manager role
router.use(authenticateToken, isAdminOrManager);

// Driver-specific reports
router.get("/driver-earnings/:driverId", getDriverEarnings);
router.get("/driver-earnings/:driverId/download", downloadDriverEarnings); // CSV
router.get("/driver-earnings/:driverId/download-excel", downloadDriverEarningsExcel); // Excel

// Monthly reports (all drivers)
router.get("/monthly/:month", getMonthlyReport);
router.get("/monthly/:month/download", downloadMonthlyReport); // CSV
router.get("/monthly/:month/download-excel", downloadMonthlyReportExcel); // Excel

// Client-specific trip reports
router.get("/client-trips/:clientId", getClientTrips);
router.get("/client-trips/:clientId/download", downloadClientTrips); // Excel only

module.exports = router;
