const router = require("express").Router();
const { login, acceptTerms } = require("../controllers/authController");
const { authenticateToken } = require("../middleware/auth");

router.post("/login", login);
router.post("/accept-terms", acceptTerms);

module.exports = router;
