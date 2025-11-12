const router = require("express").Router();
const { authenticateToken, isAdminOrManager } = require("../middleware/auth");
const {
  listClients,
  createClient,
  updateClient,
  deleteClient,
  getAdminClients,
} = require("../controllers/clientController");

router.use(authenticateToken);
router.get("/", isAdminOrManager, listClients);
router.get("/admin-created", getAdminClients); // Available to all authenticated users (drivers need this)
router.post("/", isAdminOrManager, createClient);
router.patch("/:id", isAdminOrManager, updateClient);
router.delete("/:id", isAdminOrManager, deleteClient);

module.exports = router;
