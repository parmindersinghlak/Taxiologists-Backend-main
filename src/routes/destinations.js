const router = require("express").Router();
const { authenticateToken, isAdminOrManager } = require("../middleware/auth");
const {
  listDestinations,
  createDestination,
  updateDestination,
  deleteDestination,
} = require("../controllers/destinationController");

router.use(authenticateToken);
// Allow all authenticated users (including drivers) to read destinations
router.get("/", listDestinations);
// Only admin/manager can create, update, delete destinations
router.post("/", isAdminOrManager, createDestination);
router.patch("/:id", isAdminOrManager, updateDestination);
router.delete("/:id", isAdminOrManager, deleteDestination);

module.exports = router;
