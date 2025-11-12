const mongoose = require("mongoose");

const rideSchema = new mongoose.Schema(
  {
    rideId: { type: String, unique: true, index: true },
    // Booking type: scheduled (future booking) or immediate (assigned now)
    bookingType: {
      type: String,
      enum: ["scheduled", "immediate"],
      default: "immediate",
      index: true,
    },
    // Quick trip flag - minimal details, driver completes later
    isQuickTrip: {
      type: Boolean,
      default: false,
      index: true,
    },
    // Self-assigned trip flag - driver creates and manages the entire trip
    isSelfAssigned: {
      type: Boolean,
      default: false,
      index: true,
    },
    // For quick trips, these can be optional or filled later by driver
    clients: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Client", required: false },
    ],
    from: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Destination",
      required: false,
    },
    to: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Destination",
      required: false,
    },
    // Quick trip temporary fields (filled by driver later)
    quickTripDetails: {
      clientName: { type: String, trim: true },
      clientPhone: { type: String, trim: true },
      pickupLocation: { type: String, trim: true },
      dropoffLocation: { type: String, trim: true },
      completedByDriver: { type: Boolean, default: false },
      completedAt: { type: Date },
    },
    scheduledTime: { type: Date, required: true, index: true },
    passengers: { type: Number, required: true, min: 1, default: 1 },
    fare: {
      total: { type: Number, required: true, min: 0 },
      perPerson: { type: Number, required: true, min: 0 },
      halfFare: { type: Number, required: true, min: 0 },
      gst: { type: Number, default: 0, min: 0 },
    },
    // Driver is optional for scheduled bookings (assigned later)
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
    },
    shift: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shift",
      index: true,
    },
    assignedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // Optional for self-assigned rides
    },
    status: {
      type: String,
      enum: ["scheduled", "assigned", "accepted", "started", "rejected", "cancelled", "aborted", "completed"],
      default: "assigned",
      index: true,
    },
    notes: { type: String, trim: true },
    driverNotes: { type: String, trim: true },
    // Driver action timestamps
    acceptedAt: { type: Date },
    startedAt: { type: Date }, // When driver picked up client and started the ride
    rejectedAt: { type: Date },
    droppedAt: { type: Date },
    cancelledAt: { type: Date },
    // Cancellation reason when driver cancels ongoing ride
    cancellationReason: {
      type: String,
      enum: [
        "vehicle_breakdown",
        "emergency",
        "traffic_jam",
        "client_no_show",
        "client_cancelled",
        "route_blocked",
        "personal_emergency",
        "other",
      ],
    },
    cancellationNote: { type: String, trim: true },
    // Manager abort fields
    abortedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    abortedAt: { type: Date },
    abortReason: {
      type: String,
      enum: [
        "client_request",
        "vehicle_unavailable",
        "driver_unavailable",
        "weather_conditions",
        "route_issues",
        "scheduling_conflict",
        "client_no_show",
        "other",
      ],
    },
    abortNote: { type: String, trim: true },
  },
  { timestamps: true }
);

rideSchema.index({ driver: 1, status: 1, scheduledTime: -1 });
rideSchema.index({ driver: 1, shift: 1, status: 1 });
rideSchema.index({ createdAt: -1 });

module.exports = mongoose.model("Ride", rideSchema);
