const Notification = require("../models/Notification");

/**
 * In-memory SSE hub:
 * userId(string) -> Set<res>
 */
const sseClients = new Map();

function sseAddClient(userId, res) {
  if (!sseClients.has(userId)) sseClients.set(userId, new Set());
  sseClients.get(userId).add(res);

  // Clean up on close
  res.on("close", () => {
    const set = sseClients.get(userId);
    if (set) {
      set.delete(res);
      if (set.size === 0) sseClients.delete(userId);
    }
  });
}

/** Server-Sent Event push to all user connections */
function ssePush(userId, event, payload) {
  const set = sseClients.get(String(userId));
  if (!set) return;
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of set) {
    try {
      res.write(data);
    } catch (_) {}
  }
}

/**
 * Create-or-reuse (upsert) a notification ONCE per (user,type,rideId,status).
 * This prevents repeated emits on login or repeated state writes.
 */
async function sendNotification(userId, type, payload = {}) {
  const titleMap = {
    ride_assigned: "New Ride Assigned",
    ride_reassigned: "Ride Reassigned",
    ride_status: "Ride Status Updated",
    quick_trip_assigned: "Quick Trip Assigned",
    quick_trip_created: "Quick Trip Created",
    self_assigned_ride: "Self-Assigned Ride Created",
    ride_accepted: "Ride Accepted",
    ride_rejected: "Ride Rejected",
    ride_started: "Ride Started",
    ride_completed: "Ride Completed",
    ride_cancelled: "Ride Cancelled",
    ride_aborted: "Ride Aborted",
    ride_destination_updated: "Ride Destination Updated",
    booking_scheduled: "Booking Scheduled",
    agreement_submitted: "New Agreement Submitted",
    agreement_approved: "Agreement Approved",
    agreement_rejected: "Agreement Rejected",
    shift_started: "Shift Started",
    shift_ended: "Shift Ended",
  };
  const title = titleMap[type] || "Notification";
  const message = payload.message || "";
  const rideId = payload.rideId || null; // required for de-dup key
  const agreementId = payload.agreementId || null; // for agreement notifications
  const shiftId = payload.shiftId || null; // for shift notifications
  const status = payload.status || null; // accepted | canceled | completed | assigned | etc.

  // Upsert key: one row per (user, type, rideId/agreementId/shiftId, status)
  let filter;
  if (agreementId) {
    filter = { user: userId, type, "data.agreementId": agreementId };
  } else if (shiftId) {
    // For shifts, always create new notifications (no dedup) by including timestamp
    filter = { user: userId, type, "data.shiftId": shiftId, "data.timestamp": payload.timestamp };
  } else {
    filter = { user: userId, type, "data.rideId": rideId, "data.status": status };
  }
  
  const update = {
    $setOnInsert: {
      user: userId,
      type,
      title,
      message,
      data: payload || {},
      isRead: false,
      createdAt: new Date(),
    },
  };

  const doc = await Notification.findOneAndUpdate(filter, update, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
  });

  // Only stream if this looks newly inserted (avoid streaming old/duplicate on login)
  const isFresh = Date.now() - new Date(doc.createdAt).getTime() < 2000;
  if (isFresh) {
    ssePush(String(userId), "notification", {
      id: doc._id,
      type: doc.type,
      title: doc.title,
      message: doc.message,
      data: doc.data,
      createdAt: doc.createdAt,
    });
  }

  return doc;
}

/**
 * Send notification to all admins and managers
 */
async function notifyAdminsAndManagers(type, payload = {}) {
  const User = require('../models/User');
  const { ROLES } = require('../utils/constants');
  
  try {
    // Find all admins and managers
    const recipients = await User.find({ 
      role: { $in: [ROLES.ADMIN, ROLES.MANAGER] } 
    }).select('_id');
    
    // Send notification to each
    const promises = recipients.map(user => 
      sendNotification(user._id, type, payload)
    );
    
    await Promise.all(promises);
  } catch (error) {
    throw error;
  }
}

/** Optional: periodic keepalive to prevent proxies closing idle connections */
setInterval(() => {
  for (const [, set] of sseClients.entries()) {
    for (const res of set) {
      try {
        res.write(": keepalive\n\n");
      } catch (_) {}
    }
  }
}, 25_000);

module.exports = {
  // storage + streaming
  sendNotification,
  notifyAdminsAndManagers,
  // SSE hub
  sseAddClient,
  ssePush,
};
