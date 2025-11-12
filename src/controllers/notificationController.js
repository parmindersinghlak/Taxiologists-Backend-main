const mongoose = require("mongoose");
const Notification = require("../models/Notification");
const { sseAddClient } = require("../services/notificationService");

function toInt(v, def) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

/**
 * GET /api/notifications
 * Query: page, limit, unreadOnly=true|false
 */
async function listNotifications(req, res, next) {
  try {
    const page = toInt(req.query.page, 1);
    const limit = Math.min(toInt(req.query.limit, 20), 100);
    const unreadOnly = String(req.query.unreadOnly || "").toLowerCase() === "true";

    const filter = { user: req.user.id };
    if (unreadOnly) filter.isRead = false; // ✅ fix

    const [items, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit),
      Notification.countDocuments(filter),
      Notification.countDocuments({ user: req.user.id, isRead: false }),
    ]);

    res.json({ success: true, items, total, page, limit, unreadCount });
  } catch (e) {
    next(e);
  }
}

/**
 * POST /api/notifications/:id/read
 */
async function markRead(req, res, next) {
  try {
    const { id } = req.params;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Invalid id",
      });
    }
    const doc = await Notification.findOneAndUpdate(
      { _id: id, user: req.user.id },
      { isRead: true, readAt: new Date() },
      { new: true }
    );
    if (!doc) {
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Notification not found",
      });
    }
    res.json({ success: true, notification: doc });
  } catch (e) {
    next(e);
  }
}

/**
 * POST /api/notifications/read-all
 */
async function markAllRead(req, res, next) {
  try {
    const r = await Notification.updateMany(
      { user: req.user.id, isRead: false },
      { $set: { isRead: true, readAt: new Date() } }
    );
    res.json({ success: true, modified: r.modifiedCount || r.nModified || 0 });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /api/notifications/unread-count
 */
async function getUnreadCount(req, res, next) {
  try {
    const count = await Notification.countDocuments({
      user: req.user.id,
      isRead: false,
    });
    res.json({ success: true, unreadCount: count });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /api/notifications/stream (SSE)
 * Keep the connection open and push events in real-time.
 */
async function stream(req, res, next) {
  try {
    // SSE headers
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no"); // for nginx
    res.flushHeaders?.(); // if compression is enabled

    // Immediately announce connection
    res.write(`event: connected\ndata: {"ok":true}\n\n`);

    // Register client under the authenticated user
    sseAddClient(String(req.user.id), res);
    // DO NOT end the response; it stays open until client disconnects
  } catch (e) {
    next(e);
  }
}

module.exports = {
  listNotifications,
  markRead,
  markAllRead,
  getUnreadCount,
  stream,
};
