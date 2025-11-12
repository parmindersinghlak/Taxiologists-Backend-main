const mongoose = require("mongoose");

const NotificationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, required: true }, // 'ride_assigned' | 'ride_status' | 'ride_reassigned' | etc.
    title: { type: String, required: true },
    message: { type: String, default: "" },
    data: { type: mongoose.Schema.Types.Mixed, default: {} }, // include rideId, status, etc.
    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// ❗ One notification per (user, type, rideId, status)
NotificationSchema.index(
  { user: 1, type: 1, "data.rideId": 1, "data.status": 1 },
  { unique: true, partialFilterExpression: { "data.rideId": { $exists: true } } }
);

module.exports = mongoose.model("Notification", NotificationSchema);
