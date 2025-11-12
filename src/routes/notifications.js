const router = require("express").Router();
const { authenticateToken } = require("../middleware/auth");
const {
  listNotifications,
  markRead,
  markAllRead,
  getUnreadCount,
  stream,
} = require("../controllers/notificationController");

// All notifications are per-authenticated user
router.use(authenticateToken);

router.get("/", listNotifications);
router.get("/unread-count", getUnreadCount);
router.post("/:id/read", markRead);
router.post("/read-all", markAllRead);

// Real-time stream (SSE)
router.get("/stream", stream);

module.exports = router;
