const router = require("express").Router();
const {
  authenticateToken,
  isAdminOrManager,
  isAdmin,
} = require("../middleware/auth");
const {
  listUsers,
  createUser,
  getUser,
  updateUser,
  deleteUser,
} = require("../controllers/userController");

router.use(authenticateToken);

// List users (admin or manager - managers need to see drivers for dashboard)
router.get("/", isAdminOrManager, listUsers);

// Create user (admin or manager; manager can’t create admin)
router.post("/", isAdminOrManager, createUser);

// Get user by id (admin)
router.get("/:id", isAdmin, getUser);

// Update user (admin only for now)
router.patch("/:id", isAdmin, updateUser);

// Delete user (admin only)
router.delete("/:id", isAdmin, deleteUser);

module.exports = router;
