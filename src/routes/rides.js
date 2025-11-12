const router = require("express").Router();
const { authenticateToken, isAdminOrManager } = require("../middleware/auth");
const {
  assignRide,
  listRides,
  getDriverRides,
  updateRideStatus,
  reassignRide,
  getAvailableClients,
  getAvailableDrivers,
  getAllDestinations,
  acceptRide,
  rejectRide,
  startRide,
  dropRide,
  cancelOngoingRide,
  updateRideDestinations,
  createScheduledBooking,
  listScheduledBookings,
  assignScheduledBooking,
  deleteScheduledBooking,
  updateScheduledBooking,
  abortRide,
  createQuickTrip,
  completeQuickTripDetails,
  createSelfAssignedRide,
} = require("../controllers/rideController");

router.use(authenticateToken);

// List/filter rides (admin/manager)
router.get("/", isAdminOrManager, listRides);

// Manager/admin: assign
router.post("/assign", isAdminOrManager, assignRide);

// Scheduled bookings (manager/admin only)
router.post("/scheduled", isAdminOrManager, createScheduledBooking);
router.get("/scheduled", isAdminOrManager, listScheduledBookings);
router.post("/scheduled/:id/assign", isAdminOrManager, assignScheduledBooking);
router.put("/scheduled/:id", isAdminOrManager, updateScheduledBooking);
router.delete("/scheduled/:id", isAdminOrManager, deleteScheduledBooking);

// For manager assignment - get available resources
router.get("/available/clients", isAdminOrManager, getAvailableClients);
router.get("/available/drivers", isAdminOrManager, getAvailableDrivers);
router.get("/available/destinations", isAdminOrManager, getAllDestinations);

// Driver actions
router.patch("/:id/accept", acceptRide);
router.patch("/:id/reject", rejectRide);
router.patch("/:id/start", startRide);
router.patch("/:id/drop", dropRide);
router.post("/:id/cancel", cancelOngoingRide);
router.put("/:id/update-destinations", updateRideDestinations);

// Driver: see own rides (admin/manager can view any driver's rides)
router.get("/driver/:driverId", getDriverRides);

// Driver: update ride status (accept/cancel/complete)
router.put("/:id/status", updateRideStatus);

// Manager/admin: reassign ride to another driver
router.post("/:id/reassign", isAdminOrManager, reassignRide);

// Manager: abort ride
router.post("/:id/abort", isAdminOrManager, abortRide);

// Quick trips
router.post("/quick-trip", isAdminOrManager, createQuickTrip);
router.post("/:id/complete-quick-trip", completeQuickTripDetails);

// Self-assigned rides (driver only)
router.post("/self-assign", createSelfAssignedRide);

module.exports = router;
