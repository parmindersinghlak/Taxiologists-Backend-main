const router = require("express").Router();
const { authenticateToken } = require("../middleware/auth");
const { getProfile, updateProfile } = require("../controllers/profileController");

router.use(authenticateToken);

// Get current user's profile
router.get("/", getProfile);

// Update current user's profile
router.patch("/", updateProfile);

module.exports = router;
