const Ride = require("../models/Ride");
const User = require("../models/User");
const Client = require("../models/Client");
const Destination = require("../models/Destination");
const Shift = require("../models/Shift");
const { genRideId } = require("../utils/id");
const { sendNotification } = require("../services/notificationService");
const { ROLES, DRIVER_STATUS } = require("../utils/constants");
const { calculateGST } = require("./settingsController");

// Helper to notify all admins
async function notifyAdmins(type, payload) {
  const admins = await User.find({ role: ROLES.ADMIN }).select("_id");
  await Promise.all(
    admins.map((admin) => sendNotification(admin._id, type, payload))
  );
}

// Helpers
async function ensureDriverFree(driverId) {
  const driver = await User.findById(driverId);
  if (!driver || driver.role !== ROLES.DRIVER) {
    const err = new Error("Invalid driver selected");
    err.status = 400;
    err.code = "INVALID_DRIVER";
    throw err;
  }
  if (driver.status !== DRIVER_STATUS.FREE) {
    const err = new Error("Driver is not available");
    err.status = 400;
    err.code = "DRIVER_NOT_FREE";
    throw err;
  }
  return driver;
}

async function validateRefs(clientIds = [], from, to) {
  const clientsCount = await Client.countDocuments({ _id: { $in: clientIds } });
  if (clientsCount !== clientIds.length) {
    const err = new Error("One or more clients not found");
    err.status = 400;
    err.code = "INVALID_CLIENTS";
    throw err;
  }
  const fromOk = await Destination.findById(from);
  const toOk = await Destination.findById(to);
  if (!fromOk || !toOk) {
    const err = new Error("Invalid destination(s)");
    err.status = 400;
    err.code = "INVALID_DESTINATION";
    throw err;
  }
}

// Controllers
async function assignRide(req, res, next) {
  try {
    const { clients, from, to, scheduledTime, driver, notes } = req.body || {};
    // No fare validation here - manager doesn't set fare
    if (
      !Array.isArray(clients) ||
      clients.length === 0 ||
      !from ||
      !to ||
      !scheduledTime ||
      !driver
    ) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "clients[], from, to, scheduledTime, driver are required",
      });
    }

    await validateRefs(clients, from, to);
    await ensureDriverFree(driver);

    // Initialize zeroed fare so schema requirements are satisfied
    const zeroFare = {
      total: 0,
      perPerson: 0,
      halfFare: 0,
      gst: 0,
    };

    const ride = await Ride.create({
      rideId: genRideId(),
      clients,
      from,
      to,
      scheduledTime: new Date(scheduledTime),
      passengers: clients.length,
      fare: zeroFare, // ✅ manager doesn't set fare
      driver,
      assignedBy: req.user.id,
      status: "assigned",
      notes: notes || "",
    });

    // Set driver to on_ride
    await User.findByIdAndUpdate(driver, { status: DRIVER_STATUS.ON_RIDE });

    const populated = await Ride.findById(ride._id)
      .populate("clients", "name phone")
      .populate("from to", "name address")
      .populate("driver", "fullName phone")
      .populate("assignedBy", "fullName");

    const notificationPayload = {
      rideId: populated.rideId,
      from: populated.from?.name,
      to: populated.to?.name,
      message: `New ride assigned: ${populated.from?.name} → ${populated.to?.name}`,
      driver: populated.driver?.fullName,
    };

    await sendNotification(driver, "ride_assigned", notificationPayload);
    await notifyAdmins("ride_assigned", {
      ...notificationPayload,
      message: `New ride assigned to ${populated.driver?.fullName}: ${populated.from?.name} → ${populated.to?.name}`,
    });

    res.status(201).json({ success: true, ride: populated });
  } catch (e) {
    next(e);
  }
}

async function listRides(req, res, next) {
  try {
    const {
      status,
      driverId,
      clientId,
      fromDate,
      toDate,
      isQuickTrip,
      isSelfAssigned,
      page = 1,
      limit = 20,
    } = req.query;
    const filter = {};
    if (status) filter.status = status;
    if (driverId) filter.driver = driverId;
    if (clientId) filter.clients = clientId;
    if (fromDate || toDate) {
      filter.scheduledTime = {};
      if (fromDate) filter.scheduledTime.$gte = new Date(fromDate);
      if (toDate) filter.scheduledTime.$lte = new Date(toDate);
    }

    // Handle ride type filters
    if (isQuickTrip !== undefined) {
      filter.isQuickTrip = isQuickTrip === "true" || isQuickTrip === true;
    }
    if (isSelfAssigned !== undefined) {
      filter.isSelfAssigned =
        isSelfAssigned === "true" || isSelfAssigned === true;
    }

    const docs = await Ride.find(filter)
      .sort({ createdAt: -1 })
      .skip((+page - 1) * +limit)
      .limit(+limit)
      .populate("clients", "name phone")
      .populate("from to", "name address")
      .populate("driver", "fullName phone")
      .populate("assignedBy", "fullName");

    const total = await Ride.countDocuments(filter);
    res.json({ success: true, items: docs, total, page: +page, limit: +limit });
  } catch (e) {
    next(e);
  }
}

async function getDriverRides(req, res, next) {
  try {
    const { driverId } = req.params;
    const { status, limit = 50 } = req.query;

    // Allow: driver self, admin, manager
    if (req.user.role === ROLES.DRIVER && req.user.id !== driverId) {
      return res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "Drivers can only view their own rides",
      });
    }

    const filter = { driver: driverId };
    if (status) {
      filter.status = status;
    }

    const rides = await Ride.find(filter)
      .sort({ createdAt: -1 })
      .limit(+limit)
      .populate("clients", "name phone")
      .populate("from to", "name address")
      .populate("assignedBy", "fullName");

    res.json({ success: true, rides });
  } catch (e) {
    next(e);
  }
}

async function updateRideStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body || {};
    if (!["accepted", "cancelled", "completed"].includes(status)) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "status must be accepted|cancelled|completed",
      });
    }

    const ride = await Ride.findById(id);
    if (!ride)
      return res
        .status(404)
        .json({ success: false, code: "NOT_FOUND", message: "Ride not found" });

    // Only the assigned driver (or admin/manager) can change status
    const isSelfDriver =
      req.user.role === ROLES.DRIVER && req.user.id === ride.driver.toString();
    const isStaff =
      req.user.role === ROLES.ADMIN || req.user.role === ROLES.MANAGER;
    if (!isSelfDriver && !isStaff) {
      return res
        .status(403)
        .json({ success: false, code: "FORBIDDEN", message: "Not allowed" });
    }

    // Enforce transitions (and set timestamps consistently)
    if (ride.status === "assigned" && status === "accepted") {
      ride.status = "accepted";
      if (!ride.acceptedAt) ride.acceptedAt = new Date(); // ⬅️ ensure acceptedAt
      await ride.save();

      const populated = await Ride.findById(ride._id).populate(
        "driver",
        "fullName"
      );

      const notificationPayload = {
        rideId: ride.rideId,
        status: "accepted",
        message: `Driver ${populated.driver?.fullName} accepted ride ${ride.rideId}`,
      };

      // notify assigner
      if (ride.assignedBy) {
        await sendNotification(
          ride.assignedBy,
          "ride_status",
          notificationPayload
        );
      }

      // notify admins
      await notifyAdmins("ride_status", notificationPayload);

      return res.json({ success: true, ride });
    }

    if (
      ["assigned", "accepted", "started"].includes(ride.status) &&
      status === "cancelled"
    ) {
      ride.status = "cancelled";
      if (!ride.cancelledAt) ride.cancelledAt = new Date(); // ⬅️ ensure cancelledAt
      await ride.save();
      // free driver
      await User.findByIdAndUpdate(ride.driver, { status: DRIVER_STATUS.FREE });

      const populated = await Ride.findById(ride._id).populate(
        "driver",
        "fullName"
      );

      const notificationPayload = {
        rideId: ride.rideId,
        status: "cancelled",
        message: `Driver ${populated.driver?.fullName} cancelled ride ${ride.rideId}`,
      };

      // notify assigner
      if (ride.assignedBy) {
        await sendNotification(
          ride.assignedBy,
          "ride_status",
          notificationPayload
        );
      }

      // notify admins
      await notifyAdmins("ride_status", notificationPayload);

      return res.json({ success: true, ride });
    }

    // 🔒 STRICT: Can only complete a "started" ride
    if (ride.status === "started" && status === "completed") {
      // Double-check startedAt exists
      if (!ride.startedAt) {
        return res.status(409).json({
          success: false,
          code: "RIDE_NOT_STARTED",
          message: "Ride must be started (pickup recorded) before completion",
        });
      }

      ride.status = "completed";
      if (!ride.droppedAt) ride.droppedAt = new Date();
      await ride.save();
      // free driver
      await User.findByIdAndUpdate(ride.driver, { status: DRIVER_STATUS.FREE });

      const populated = await Ride.findById(ride._id).populate(
        "driver",
        "fullName"
      );

      const notificationPayload = {
        rideId: ride.rideId,
        status: "completed",
        message: `Driver ${populated.driver?.fullName} completed ride ${ride.rideId}`,
      };

      // notify assigner
      if (ride.assignedBy) {
        await sendNotification(
          ride.assignedBy,
          "ride_status",
          notificationPayload
        );
      }

      // notify admins
      await notifyAdmins("ride_status", notificationPayload);

      return res.json({ success: true, ride });
    }

    return res.status(409).json({
      success: false,
      code: "INVALID_TRANSITION",
      message: `Cannot transition from ${ride.status} to ${status}`,
    });
  } catch (e) {
    next(e);
  }
}

async function reassignRide(req, res, next) {
  try {
    const { id } = req.params;
    const { driver: newDriverId } = req.body || {};
    if (!newDriverId) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "driver is required",
      });
    }

    const ride = await Ride.findById(id).populate("from to", "name address");
    if (!ride)
      return res
        .status(404)
        .json({ success: false, code: "NOT_FOUND", message: "Ride not found" });

    if (ride.status !== "assigned") {
      return res.status(409).json({
        success: false,
        code: "INVALID_TRANSITION",
        message: "Only assigned rides can be reassigned",
      });
    }

    const oldDriverId = ride.driver.toString();

    // free current driver
    await User.findByIdAndUpdate(oldDriverId, { status: DRIVER_STATUS.FREE });

    // ensure new driver free
    await ensureDriverFree(newDriverId);

    // set new driver
    ride.driver = newDriverId;
    await ride.save();

    // set new driver on_ride
    await User.findByIdAndUpdate(newDriverId, {
      status: DRIVER_STATUS.ON_RIDE,
    });

    // notify new driver
    await sendNotification(newDriverId, "ride_reassigned", {
      rideId: ride.rideId,
      from: ride.from?.name,
      to: ride.to?.name,
      message: `Ride reassigned to you: ${ride.from?.name} → ${ride.to?.name}`,
    });

    // notify old driver
    await sendNotification(oldDriverId, "ride_status", {
      rideId: ride.rideId,
      status: "reassigned",
      message: `Ride reassigned away from you`,
    });

    const populated = await Ride.findById(ride._id)
      .populate("clients", "name phone")
      .populate("from to", "name address")
      .populate("driver", "fullName phone")
      .populate("assignedBy", "fullName");

    return res.json({ success: true, ride: populated });
  } catch (e) {
    next(e);
  }
}

async function getAvailableClients(req, res, next) {
  try {

    // Get only admin-created clients (exclude driver-added clients)
    const allClients = await Client.find({ isDriverAdded: { $ne: true } })
      .select("_id name phone email")
      .sort({ name: 1 });

    if (allClients.length === 0) {
      const rawClients = await Client.find({});
    }

    // Get clients who are not currently in an active ride (assigned, accepted)
    const activeRides = await Ride.find({
      status: { $in: ["assigned", "accepted"] },
    }).distinct("clients");

    const availableClients = await Client.find({
      _id: { $nin: activeRides },
      isDriverAdded: { $ne: true }, // Exclude driver-added clients from manager selection
    })
      .select("_id name phone email")
      .sort({ name: 1 });

    // Add cache-busting header
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    res.json({
      success: true,
      clients: availableClients,
      timestamp: Date.now(),
    });
  } catch (e) {
    next(e);
  }
}

async function getAvailableDrivers(req, res, next) {
  try {
    // Get drivers with status = 'free'
    const availableDrivers = await User.find({
      role: ROLES.DRIVER,
      status: DRIVER_STATUS.FREE,
    })
      .select("_id username fullName phone")
      .sort({ fullName: 1, username: 1 });

    res.json({ success: true, drivers: availableDrivers });
  } catch (e) {
    next(e);
  }
}

async function getAllDestinations(req, res, next) {
  try {
    const destinations = await Destination.find({})
      .select("_id name address isDriverGenerated")
      .sort({ name: 1 });

    res.json({ success: true, destinations });
  } catch (e) {
    next(e);
  }
}

// Driver action endpoints
async function acceptRide(req, res, next) {
  try {
    const { id } = req.params;

    const ride = await Ride.findById(id);
    if (!ride) {
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Ride not found",
      });
    }

    // Only assigned driver can accept
    if (req.user.id !== ride.driver.toString()) {
      return res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "Not authorized to accept this ride",
      });
    }

    // 🔒 STRICT: Only "assigned" rides can be accepted
    if (ride.status !== "assigned") {
      return res.status(409).json({
        success: false,
        code: "INVALID_STATUS",
        message: "Only assigned rides can be accepted",
      });
    }

    // Check for active shift
    const activeShift = await Shift.findOne({
      driver: req.user.id,
      isActive: true,
    });
    if (!activeShift) {
      return res.status(400).json({
        success: false,
        code: "NO_ACTIVE_SHIFT",
        message: "You must start a shift before accepting rides",
      });
    }

    // Update ride status, timestamp, and link to shift
    ride.status = "accepted";
    ride.acceptedAt = new Date();
    ride.shift = activeShift._id;
    await ride.save();

    // Ensure driver is marked as on_ride
    await User.findByIdAndUpdate(ride.driver, {
      status: DRIVER_STATUS.ON_RIDE,
    });

    // Notify manager
    if (ride.assignedBy) {
      await sendNotification(ride.assignedBy, "ride_accepted", {
        rideId: ride.rideId,
        message: `Driver accepted ride ${ride.rideId}`,
      });
    }

    // Notify admins
    await notifyAdmins("ride_accepted", {
      rideId: ride.rideId,
      message: `Driver accepted ride ${ride.rideId}`,
    });

    const populated = await Ride.findById(ride._id)
      .populate("clients", "name phone")
      .populate("from to", "name address")
      .populate("assignedBy", "fullName");

    res.json({ success: true, ride: populated });
  } catch (e) {
    next(e);
  }
}

async function rejectRide(req, res, next) {
  try {
    const { id } = req.params;

    const ride = await Ride.findById(id);
    if (!ride) {
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Ride not found",
      });
    }

    // Only assigned driver can reject
    if (req.user.id !== ride.driver.toString()) {
      return res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "Not authorized to reject this ride",
      });
    }

    if (ride.status !== "assigned") {
      return res.status(409).json({
        success: false,
        code: "INVALID_STATUS",
        message: "Only assigned rides can be rejected",
      });
    }

    // Update ride status and timestamp
    ride.status = "rejected";
    ride.rejectedAt = new Date();
    await ride.save();

    // Free up the driver
    await User.findByIdAndUpdate(ride.driver, { status: DRIVER_STATUS.FREE });

    // Notify manager
    if (ride.assignedBy) {
      await sendNotification(ride.assignedBy, "ride_rejected", {
        rideId: ride.rideId,
        message: `Driver rejected ride ${ride.rideId}`,
      });
    }

    res.json({ success: true, message: "Ride rejected successfully" });
  } catch (e) {
    next(e);
  }
}

async function dropRide(req, res, next) {
  try {
    const { id } = req.params;
    const {
      fareTotal,
      driverNotes,
      from,
      to,
      passengers,
      additionalClientIds,
      additionalClients,
    } = req.body || {};

    const ride = await Ride.findById(id);
    if (!ride) {
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Ride not found",
      });
    }

    // Only assigned driver can drop
    if (req.user.id !== ride.driver.toString()) {
      return res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "Not authorized to complete this ride",
      });
    }

    // 🔒 STRICT: Must be "started" before completion
    if (ride.status !== "started") {
      return res.status(409).json({
        success: false,
        code: "INVALID_STATUS",
        message:
          "Only started rides can be completed. Please start the ride first.",
      });
    }

    // Double-check startedAt exists
    if (!ride.startedAt) {
      return res.status(400).json({
        success: false,
        code: "RIDE_NOT_STARTED",
        message:
          "You must start the ride (pickup recorded) before completing it.",
      });
    }

    // Check for active shift
    const activeShift = await Shift.findOne({
      driver: req.user.id,
      isActive: true,
    });
    if (!activeShift) {
      return res.status(400).json({
        success: false,
        code: "NO_ACTIVE_SHIFT",
        message: "You must have an active shift to complete rides",
      });
    }

    // Ensure ride is linked to shift
    if (!ride.shift) {
      ride.shift = activeShift._id;
    }

    // 🚫 Disallow creating brand-new clients from the driver app
    if (
      additionalClients &&
      Array.isArray(additionalClients) &&
      additionalClients.length > 0
    ) {
      return res.status(400).json({
        success: false,
        code: "NEW_CLIENTS_NOT_ALLOWED",
        message:
          "Drivers cannot add new clients. Please select existing clients only.",
      });
    }

    // Validate destination updates if provided
    if (from && from !== ride.from.toString()) {
      const fromDest = await Destination.findById(from);
      if (!fromDest) {
        return res.status(400).json({
          success: false,
          code: "INVALID_DESTINATION",
          message: "Invalid 'from' destination",
        });
      }
      ride.from = from;
    }

    if (to && to !== ride.to.toString()) {
      const toDest = await Destination.findById(to);
      if (!toDest) {
        return res.status(400).json({
          success: false,
          code: "INVALID_DESTINATION",
          message: "Invalid 'to' destination",
        });
      }
      ride.to = to;
    }

    // Update passenger count if provided
    if (passengers && passengers !== ride.passengers) {
      if (passengers < 1) {
        return res.status(400).json({
          success: false,
          code: "VALIDATION_ERROR",
          message: "Passenger count must be at least 1",
        });
      }
      ride.passengers = passengers;
    }

    // Handle existing admin-created clients selected by driver
    if (
      additionalClientIds &&
      Array.isArray(additionalClientIds) &&
      additionalClientIds.length > 0
    ) {
      const validClientIds = additionalClientIds.filter(
        (id) => id && typeof id === "string"
      );
      if (validClientIds.length > 0) {
        // Verify all client IDs exist
        const existingClients = await Client.countDocuments({
          _id: { $in: validClientIds },
        });
        if (existingClients !== validClientIds.length) {
          return res.status(400).json({
            success: false,
            code: "INVALID_CLIENTS",
            message: "One or more selected clients not found",
          });
        }
        // Add to existing clients array
        ride.clients = [...ride.clients, ...validClientIds];
      }
    }

    // Handle fare updates and always recalculate perPerson
    let updatedTotal = ride.fare.total;
    if (fareTotal != null) {
      const parsedFareTotal = parseFloat(fareTotal);
      if (isNaN(parsedFareTotal) || parsedFareTotal < 0) {
        return res.status(400).json({
          success: false,
          code: "VALIDATION_ERROR",
          message: "Fare total must be a non-negative number",
        });
      }
      updatedTotal = parsedFareTotal;
    }

    // Use total client count (original + additional selected) for per-person calculation
    const totalClientCount = ride.clients.length;
    const farePerPerson =
      totalClientCount > 0
        ? Number((updatedTotal / totalClientCount).toFixed(2))
        : 0;
    const halfFare = Number((updatedTotal / 2).toFixed(2));
    const gst = await calculateGST(farePerPerson);

    ride.fare.total = updatedTotal;
    ride.fare.perPerson = farePerPerson;
    ride.fare.halfFare = halfFare;
    ride.fare.gst = gst;

    // Always update passengers to match total clients
    ride.passengers = totalClientCount;

    // Add driver notes if provided
    if (driverNotes) {
      ride.driverNotes = driverNotes.trim();
    }

    // Update ride status and timestamp
    ride.status = "completed";
    ride.droppedAt = new Date();

    // Save ride with all updates including any selected clients
    await ride.save();

    // Free up the driver
    await User.findByIdAndUpdate(ride.driver, { status: DRIVER_STATUS.FREE });

    // Notify manager
    if (ride.assignedBy) {
      await sendNotification(ride.assignedBy, "ride_completed", {
        rideId: ride.rideId,
        message: `Ride ${ride.rideId} completed successfully`,
      });
    }

    // Notify admins
    await notifyAdmins("ride_completed", {
      rideId: ride.rideId,
      message: `Ride ${ride.rideId} completed successfully`,
    });

    const populated = await Ride.findById(ride._id)
      .populate("clients", "name phone")
      .populate("from to", "name address")
      .populate("assignedBy", "fullName");

    res.json({ success: true, ride: populated });
  } catch (e) {
    next(e);
  }
}

// New enhanced cancel ride function with reason support
async function cancelOngoingRide(req, res, next) {
  try {
    const { id } = req.params;
    const { reason, note } = req.body || {};

    if (!reason) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Cancellation reason is required",
      });
    }

    const validReasons = [
      "vehicle_breakdown",
      "emergency",
      "traffic_jam",
      "client_no_show",
      "client_cancelled",
      "route_blocked",
      "personal_emergency",
      "other",
    ];

    if (!validReasons.includes(reason)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_REASON",
        message: "Invalid cancellation reason",
      });
    }

    const ride = await Ride.findById(id);
    if (!ride) {
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Ride not found",
      });
    }

    // Only assigned driver can cancel
    if (req.user.id !== ride.driver.toString()) {
      return res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "Not authorized to cancel this ride",
      });
    }

    // Can cancel assigned, accepted, and started rides
    if (!["assigned", "accepted", "started"].includes(ride.status)) {
      return res.status(409).json({
        success: false,
        code: "INVALID_STATUS",
        message: "Only assigned, accepted, or started rides can be cancelled",
      });
    }

    // Update ride with cancellation details
    ride.status = "cancelled";
    ride.cancelledAt = new Date();
    ride.cancellationReason = reason;
    if (note) {
      ride.cancellationNote = note;
    }
    await ride.save();

    // Free up the driver
    await User.findByIdAndUpdate(ride.driver, { status: DRIVER_STATUS.FREE });

    // Get populated ride for notifications
    const populated = await Ride.findById(ride._id)
      .populate("clients", "name phone")
      .populate("from to", "name address")
      .populate("driver", "fullName")
      .populate("assignedBy", "fullName");

    const reasonText = reason
      .replace(/_/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase());
    const notificationPayload = {
      rideId: ride.rideId,
      status: "cancelled",
      reason: reasonText,
      message: `Driver ${populated.driver?.fullName} cancelled ride ${
        ride.rideId
      } - Reason: ${reasonText}${note ? ` (${note})` : ""}`,
    };

    // Notify manager
    if (ride.assignedBy) {
      await sendNotification(
        ride.assignedBy,
        "ride_cancelled",
        notificationPayload
      );
    }

    // Notify admins
    await notifyAdmins("ride_cancelled", notificationPayload);

    res.json({
      success: true,
      message: "Ride cancelled successfully",
      ride: populated,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * PATCH /api/rides/:id/start
 * Roles: driver (own rides only)
 * Start the ride after picking up the client
 */
async function startRide(req, res, next) {
  try {
    const { id } = req.params;

    const ride = await Ride.findById(id);
    if (!ride) {
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Ride not found",
      });
    }

    // Only assigned driver can start the ride
    if (req.user.id !== ride.driver.toString()) {
      return res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "Not authorized to start this ride",
      });
    }

    // 🔒 STRICT: Can only start an "accepted" ride
    if (ride.status !== "accepted") {
      return res.status(409).json({
        success: false,
        code: "INVALID_STATUS",
        message:
          "Only accepted rides can be started. Please accept the ride first.",
      });
    }

    // Check if already started
    if (ride.startedAt) {
      return res.status(409).json({
        success: false,
        code: "ALREADY_STARTED",
        message: "Ride has already been started",
      });
    }

    // Check for active shift
    const activeShift = await Shift.findOne({
      driver: req.user.id,
      isActive: true,
    });
    if (!activeShift) {
      return res.status(400).json({
        success: false,
        code: "NO_ACTIVE_SHIFT",
        message: "You must have an active shift to start rides",
      });
    }

    // Ensure ride is linked to shift (in case it wasn't during accept)
    if (!ride.shift) {
      ride.shift = activeShift._id;
    }

    // Update ride with start timestamp (pickup time) and status
    ride.startedAt = new Date();
    ride.status = "started";
    await ride.save();

    // Notify manager
    if (ride.assignedBy) {
      await sendNotification(ride.assignedBy, "ride_started", {
        rideId: ride.rideId,
        message: `Driver started ride ${ride.rideId} (client picked up)`,
      });
    }

    // Notify admins
    await notifyAdmins("ride_started", {
      rideId: ride.rideId,
      message: `Driver started ride ${ride.rideId} (client picked up)`,
    });

    const populated = await Ride.findById(ride._id)
      .populate("clients", "name phone")
      .populate("from to", "name address")
      .populate("assignedBy", "fullName");

    res.json({
      success: true,
      message: "Ride started successfully",
      ride: populated,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * PUT /api/rides/:id/update-destinations
 * Roles: driver (own rides only)
 * Update From/To destinations for active rides
 */
async function updateRideDestinations(req, res, next) {
  try {
    const { id } = req.params;
    const { customFrom, customTo } = req.body;

    // FIRST: Fetch the ride from database
    const ride = await Ride.findById(id);
    if (!ride) {
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Ride not found",
      });
    }

    // Only assigned driver can update destinations
    if (req.user.id !== ride.driver.toString()) {
      return res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "Not authorized to update this ride",
      });
    }

    // Only allow updates for accepted or started rides
    if (ride.status !== "accepted" && ride.status !== "started") {
      return res.status(409).json({
        success: false,
        code: "INVALID_STATUS",
        message: "Only accepted or started rides can have destinations updated",
      });
    }

    // Handle custom 'from' destination
    if (customFrom && customFrom.trim()) {
      try {
        const data = {
          name: customFrom.trim(),
          address: customFrom.trim(),
          createdBy: req.user.id,
          isDriverGenerated: true,
        };
        if (
          req.body.fromCoordinates?.lat != null &&
          req.body.fromCoordinates?.lng != null
        ) {
          data.coordinates = req.body.fromCoordinates;
        }

        const savedFrom = await Destination.create(data);
        ride.from = savedFrom._id;
      } catch (error) {
        return res.status(500).json({
          success: false,
          code: "DESTINATION_ERROR",
          message: "Failed to create new pickup location",
          error: error.message,
        });
      }
    }

    // Handle custom 'to' destination
    if (customTo && customTo.trim()) {
      try {
        const data = {
          name: customTo.trim(),
          address: customTo.trim(),
          createdBy: req.user.id,
          isDriverGenerated: true,
        };
        if (
          req.body.toCoordinates?.lat != null &&
          req.body.toCoordinates?.lng != null
        ) {
          data.coordinates = req.body.toCoordinates;
        }

        const savedTo = await Destination.create(data);
        ride.to = savedTo._id;
      } catch (error) {
        return res.status(500).json({
          success: false,
          code: "DESTINATION_ERROR",
          message: "Failed to create new drop-off location",
          error: error.message,
        });
      }
    }

    await ride.save();

    // Populate the updated ride for response
    const updatedRide = await Ride.findById(ride._id)
      .populate("clients", "name phone")
      .populate("from to", "name address")
      .populate("driver", "fullName")
      .populate("assignedBy", "fullName");

    // Notify manager about the destination change
    if (ride.assignedBy) {
      await sendNotification(ride.assignedBy, "ride_destination_updated", {
        rideId: ride.rideId,
        message: `Driver updated destinations for ride ${ride.rideId}`,
      });
    }

    // Notify admins
    await notifyAdmins("ride_destination_updated", {
      rideId: ride.rideId,
      message: `Driver updated destinations for ride ${ride.rideId}`,
    });

    res.json({
      success: true,
      message: "Ride destinations updated successfully",
      ride: updatedRide,
    });
  } catch (e) {
    res.status(500).json({
      success: false,
      code: "SERVER_ERROR",
      message: "Internal server error while updating destinations",
      error: e.message,
    });
  }
}

/**
 * POST /api/rides/scheduled
 * Roles: manager, admin
 * Create a future scheduled booking without assigning to a driver
 */
async function createScheduledBooking(req, res, next) {
  try {
    const { clients, from, to, scheduledTime, notes } = req.body || {};

    if (
      !Array.isArray(clients) ||
      clients.length === 0 ||
      !from ||
      !to ||
      !scheduledTime
    ) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "clients[], from, to, scheduledTime are required",
      });
    }

    // Validate that scheduledTime is in the future
    const scheduleDate = new Date(scheduledTime);
    if (scheduleDate <= new Date()) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Scheduled time must be in the future",
      });
    }

    await validateRefs(clients, from, to);

    // Initialize zeroed fare
    const zeroFare = {
      total: 0,
      perPerson: 0,
      halfFare: 0,
      gst: 0,
    };

    const booking = await Ride.create({
      rideId: genRideId(),
      bookingType: "scheduled",
      clients,
      from,
      to,
      scheduledTime: scheduleDate,
      passengers: clients.length,
      fare: zeroFare,
      driver: null, // No driver assigned yet
      assignedBy: req.user.id,
      status: "scheduled",
      notes: notes || "",
    });

    const populated = await Ride.findById(booking._id)
      .populate("clients", "name phone")
      .populate("from to", "name address")
      .populate("assignedBy", "fullName");

    // Notify admins about new scheduled booking
    await notifyAdmins("booking_scheduled", {
      rideId: populated.rideId,
      from: populated.from?.name,
      to: populated.to?.name,
      scheduledTime: scheduleDate.toISOString(),
      message: `New scheduled booking: ${populated.from?.name} → ${
        populated.to?.name
      } at ${scheduleDate.toLocaleString()}`,
    });

    res.status(201).json({ success: true, booking: populated });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /api/rides/scheduled
 * Roles: manager, admin
 * List all scheduled bookings (not yet assigned to drivers)
 */
async function listScheduledBookings(req, res, next) {
  try {
    const { fromDate, toDate, page = 1, limit = 20 } = req.query;

    const filter = {
      status: "scheduled",
      bookingType: "scheduled",
    };

    if (fromDate || toDate) {
      filter.scheduledTime = {};
      if (fromDate) filter.scheduledTime.$gte = new Date(fromDate);
      if (toDate) filter.scheduledTime.$lte = new Date(toDate);
    }

    const docs = await Ride.find(filter)
      .sort({ scheduledTime: 1 }) // Sort by scheduled time ascending
      .skip((+page - 1) * +limit)
      .limit(+limit)
      .populate("clients", "name phone")
      .populate("from to", "name address")
      .populate("assignedBy", "fullName");

    const total = await Ride.countDocuments(filter);

    res.json({
      success: true,
      bookings: docs,
      total,
      page: +page,
      limit: +limit,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * POST /api/rides/scheduled/:id/assign
 * Roles: manager, admin
 * Assign a scheduled booking to a driver
 */
async function assignScheduledBooking(req, res, next) {
  try {
    const { id } = req.params;
    const { driver: driverId } = req.body || {};

    if (!driverId) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "driver is required",
      });
    }

    const booking = await Ride.findById(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Scheduled booking not found",
      });
    }

    if (booking.status !== "scheduled") {
      return res.status(409).json({
        success: false,
        code: "INVALID_STATUS",
        message: "Only scheduled bookings can be assigned",
      });
    }

    // Ensure driver is free
    await ensureDriverFree(driverId);

    // Update booking to assigned status
    booking.driver = driverId;
    booking.status = "assigned";
    booking.bookingType = "immediate"; // Now it's an immediate assignment
    await booking.save();

    // Set driver to on_ride
    await User.findByIdAndUpdate(driverId, { status: DRIVER_STATUS.ON_RIDE });

    const populated = await Ride.findById(booking._id)
      .populate("clients", "name phone")
      .populate("from to", "name address")
      .populate("driver", "fullName phone")
      .populate("assignedBy", "fullName");

    const notificationPayload = {
      rideId: populated.rideId,
      from: populated.from?.name,
      to: populated.to?.name,
      message: `Scheduled ride assigned: ${populated.from?.name} → ${populated.to?.name}`,
      driver: populated.driver?.fullName,
    };

    // Notify driver
    await sendNotification(driverId, "ride_assigned", notificationPayload);

    // Notify admins
    await notifyAdmins("ride_assigned", {
      ...notificationPayload,
      message: `Scheduled ride assigned to ${populated.driver?.fullName}: ${populated.from?.name} → ${populated.to?.name}`,
    });

    res.json({ success: true, ride: populated });
  } catch (e) {
    next(e);
  }
}

/**
 * DELETE /api/rides/scheduled/:id
 * Roles: manager, admin
 * Delete a scheduled booking (before it's assigned)
 */
async function deleteScheduledBooking(req, res, next) {
  try {
    const { id } = req.params;

    const booking = await Ride.findById(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Scheduled booking not found",
      });
    }

    if (booking.status !== "scheduled") {
      return res.status(409).json({
        success: false,
        code: "INVALID_STATUS",
        message: "Only scheduled bookings can be deleted",
      });
    }

    await Ride.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Scheduled booking deleted successfully",
    });
  } catch (e) {
    next(e);
  }
}

/**
 * PUT /api/rides/scheduled/:id
 * Roles: manager, admin
 * Update a scheduled booking (before it's assigned)
 */
async function updateScheduledBooking(req, res, next) {
  try {
    const { id } = req.params;
    const { clients, from, to, scheduledTime, notes } = req.body || {};

    const booking = await Ride.findById(id);
    if (!booking) {
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Scheduled booking not found",
      });
    }

    if (booking.status !== "scheduled") {
      return res.status(409).json({
        success: false,
        code: "INVALID_STATUS",
        message: "Only scheduled bookings can be updated",
      });
    }

    // Update fields if provided
    if (clients && Array.isArray(clients) && clients.length > 0) {
      await validateRefs(clients, booking.from, booking.to);
      booking.clients = clients;
      booking.passengers = clients.length;
    }

    if (from) {
      const fromDest = await Destination.findById(from);
      if (!fromDest) {
        return res.status(400).json({
          success: false,
          code: "INVALID_DESTINATION",
          message: "Invalid 'from' destination",
        });
      }
      booking.from = from;
    }

    if (to) {
      const toDest = await Destination.findById(to);
      if (!toDest) {
        return res.status(400).json({
          success: false,
          code: "INVALID_DESTINATION",
          message: "Invalid 'to' destination",
        });
      }
      booking.to = to;
    }

    if (scheduledTime) {
      const scheduleDate = new Date(scheduledTime);
      if (scheduleDate <= new Date()) {
        return res.status(400).json({
          success: false,
          code: "VALIDATION_ERROR",
          message: "Scheduled time must be in the future",
        });
      }
      booking.scheduledTime = scheduleDate;
    }

    if (notes !== undefined) {
      booking.notes = notes;
    }

    await booking.save();

    const populated = await Ride.findById(booking._id)
      .populate("clients", "name phone")
      .populate("from to", "name address")
      .populate("assignedBy", "fullName");

    res.json({ success: true, booking: populated });
  } catch (e) {
    next(e);
  }
}

// Manager abort ride function
async function abortRide(req, res, next) {
  try {
    const { id } = req.params;
    const { reason, note } = req.body || {};

    // Validate reason
    if (!reason) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Abort reason is required",
      });
    }

    const validReasons = [
      "client_request",
      "vehicle_unavailable",
      "driver_unavailable",
      "weather_conditions",
      "route_issues",
      "scheduling_conflict",
      "client_no_show",
      "other",
    ];

    if (!validReasons.includes(reason)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_REASON",
        message: "Invalid abort reason",
      });
    }

    const ride = await Ride.findById(id).populate("driver assignedBy");
    if (!ride) {
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Ride not found",
      });
    }

    // Only managers can abort rides
    if (req.user.role !== "manager") {
      return res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "Only managers can abort rides",
      });
    }

    // Can abort assigned or accepted rides (not completed, rejected, or already cancelled/aborted)
    if (!["assigned", "accepted"].includes(ride.status)) {
      return res.status(409).json({
        success: false,
        code: "INVALID_STATUS",
        message: "Only assigned or accepted rides can be aborted",
      });
    }

    // Update ride with abort details
    ride.status = "aborted";
    ride.abortedAt = new Date();
    ride.abortedBy = req.user.id;
    ride.abortReason = reason;
    if (note) {
      ride.abortNote = note;
    }
    await ride.save();

    // Free the driver if assigned
    if (ride.driver) {
      await User.findByIdAndUpdate(ride.driver, {
        status: DRIVER_STATUS.FREE,
      });
    }

    // Populate for response
    const populated = await Ride.findById(ride._id)
      .populate("clients driver assignedBy abortedBy from to")
      .lean();

    // Format reason for notification
    const reasonText = reason
      .replace(/_/g, " ")
      .replace(/\b\w/g, (l) => l.toUpperCase());

    const managerName = req.user.fullName || req.user.username;
    const notificationPayload = {
      rideId: ride.rideId,
      status: "aborted",
      reason: reasonText,
      message: `Manager ${managerName} aborted ride ${
        ride.rideId
      } - Reason: ${reasonText}${note ? ` (${note})` : ""}`,
    };

    // Notify the driver if assigned
    if (ride.driver) {
      await sendNotification(
        ride.driver._id,
        "ride_aborted",
        notificationPayload
      );
    }

    // Notify admins
    await notifyAdmins("ride_aborted", notificationPayload);

    res.json({
      success: true,
      message: "Ride aborted successfully",
      ride: populated,
    });
  } catch (e) {
    next(e);
  }
}

// ============================================
// QUICK TRIP FUNCTIONS
// ============================================

/**
 * Create a quick trip with minimal details
 * Manager assigns driver immediately, driver fills details later
 */
async function createQuickTrip(req, res, next) {
  try {
    const { driverId, notes } = req.body;

    // Validate driver
    const driver = await ensureDriverFree(driverId);

    // Find active shift for driver
    const activeShift = await Shift.findOne({
      driver: driverId,
      status: "active",
    });

    // Generate ride ID
    const rideId = await genRideId();

    // Create quick trip with minimal details
    const ride = await Ride.create({
      rideId,
      isQuickTrip: true,
      bookingType: "immediate",
      driver: driverId,
      shift: activeShift?._id,
      assignedBy: req.user.id,
      scheduledTime: new Date(), // Immediate
      passengers: 1, // Default
      fare: {
        total: 0, // Driver will update after trip
        perPerson: 0,
        halfFare: 0,
        gst: 0,
      },
      status: "assigned",
      notes: notes || "Quick trip - details to be completed by driver",
      quickTripDetails: {
        completedByDriver: false,
      },
    });

    // Update driver status to ON_RIDE (same as regular rides)
    await User.findByIdAndUpdate(driverId, {
      status: DRIVER_STATUS.ON_RIDE,
    });

    // Populate for response
    const populated = await Ride.findById(ride._id)
      .populate("driver", "fullName phone username")
      .populate("assignedBy", "fullName username");

    // Notify driver
    await sendNotification(driverId, "quick_trip_assigned", {
      rideId: ride.rideId,
      message: "New quick trip assigned - complete details after pickup",
    });

    // Notify admins
    await notifyAdmins("quick_trip_created", {
      rideId: ride.rideId,
      driver: driver.fullName || driver.username,
      manager: req.user.fullName || req.user.username,
    });

    res.status(201).json({
      success: true,
      message: "Quick trip created successfully",
      ride: populated,
    });
  } catch (e) {
    next(e);
  }
}

/**
 * Driver completes quick trip with details (drop-off + details in one step)
 */
async function completeQuickTripDetails(req, res, next) {
  try {
    const { id } = req.params;
    const {
      clientName,
      pickupLocation,
      dropoffLocation,
      fareTotal,
      driverNotes,
    } = req.body;

    const ride = await Ride.findById(id).populate("driver");
    if (!ride) {
      return res.status(404).json({
        success: false,
        code: "RIDE_NOT_FOUND",
        message: "Ride not found",
      });
    }

    // Verify it's a quick trip
    if (!ride.isQuickTrip) {
      return res.status(400).json({
        success: false,
        code: "NOT_QUICK_TRIP",
        message: "This is not a quick trip",
      });
    }

    // Verify driver owns this ride
    if (
      req.user.role === ROLES.DRIVER &&
      ride.driver._id.toString() !== req.user.id
    ) {
      return res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "You can only complete your own rides",
      });
    }

    // 🔒 STRICT: Quick trips must be "started" before completion
    if (ride.status !== "started") {
      return res.status(400).json({
        success: false,
        code: "INVALID_STATUS",
        message:
          "Quick trip must be started before completion. Please start the ride first.",
      });
    }

    // Double-check startedAt exists
    if (!ride.startedAt) {
      return res.status(400).json({
        success: false,
        code: "RIDE_NOT_STARTED",
        message: "Quick trip must be started before adding details",
      });
    }

    // Validate required fields for quick trip completion
    if (!clientName || !clientName.trim()) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Client name is required",
      });
    }

    if (!pickupLocation || !pickupLocation.trim()) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Pickup location is required",
      });
    }

    if (!dropoffLocation || !dropoffLocation.trim()) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Drop-off location is required",
      });
    }

    const parsedFare = parseFloat(fareTotal);
    if (isNaN(parsedFare) || parsedFare <= 0) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Valid fare amount is required",
      });
    }

    // Create client for quick trip (driver-generated)
    const client = await Client.create({
      name: clientName.trim(),
      createdBy: req.user.id,
      isDriverAdded: true, // Mark as driver-generated
    });

    // Create destinations for pickup and dropoff
    const fromDest = await Destination.create({
      name: pickupLocation.trim(),
      address: pickupLocation.trim(),
      createdBy: req.user.id,
      isDriverGenerated: true,
    });

    const toDest = await Destination.create({
      name: dropoffLocation.trim(),
      address: dropoffLocation.trim(),
      createdBy: req.user.id,
      isDriverGenerated: true,
    });

    // Update ride with client and destinations
    ride.clients = [client._id];
    ride.from = fromDest._id;
    ride.to = toDest._id;

    // Update quick trip details
    ride.quickTripDetails = {
      clientName: clientName.trim(),
      clientPhone: "",
      pickupLocation: pickupLocation.trim(),
      dropoffLocation: dropoffLocation.trim(),
      completedByDriver: true,
      completedAt: new Date(),
    };

    // Calculate GST
    const gst = await calculateGST(parsedFare);

    // Update fare
    ride.fare = {
      total: parsedFare,
      perPerson: parsedFare,
      halfFare: parsedFare / 2,
      gst: gst,
    };

    // Update driver notes if provided
    if (driverNotes && driverNotes.trim()) {
      ride.driverNotes = driverNotes.trim();
    }

    // Mark ride as completed
    ride.status = "completed";
    ride.droppedAt = new Date();

    await ride.save();

    // Set driver status back to FREE
    await User.findByIdAndUpdate(ride.driver._id, {
      status: DRIVER_STATUS.FREE,
    });

    const populated = await Ride.findById(ride._id)
      .populate("driver", "fullName phone username")
      .populate("clients", "name phone")
      .populate("from to", "name address")
      .populate("assignedBy", "fullName username");

    // Notify manager
    if (ride.assignedBy) {
      await sendNotification(ride.assignedBy, "ride_completed", {
        rideId: ride.rideId,
        message: `Quick trip ${ride.rideId} completed by driver`,
      });
    }

    // Notify admins
    await notifyAdmins("ride_completed", {
      rideId: ride.rideId,
      driverName: ride.driver.fullName || ride.driver.username,
      isQuickTrip: true,
    });

    res.json({
      success: true,
      message: "Quick trip completed successfully",
      ride: populated,
    });
  } catch (e) {
    next(e);
  }
}

// ========== SELF-ASSIGNED RIDES ==========
async function createSelfAssignedRide(req, res, next) {
  try {
    const {
      clientName,
      pickupLocation,
      dropoffLocation,
      scheduledTime,
      fareTotal,
      passengers,
      driverNotes,
    } = req.body;

    // Verify user is a driver
    if (req.user.role !== ROLES.DRIVER) {
      return res.status(403).json({
        success: false,
        code: "FORBIDDEN",
        message: "Only drivers can create self-assigned rides",
      });
    }

    // Check if driver has an active shift
    const activeShift = await Shift.findOne({
      driver: req.user.id,
      status: "active",
    });

    if (!activeShift) {
      return res.status(400).json({
        success: false,
        code: "NO_ACTIVE_SHIFT",
        message: "You must start a shift before creating a self-assigned ride",
      });
    }

    // Validate required fields
    if (!clientName || !clientName.trim()) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Client name is required",
      });
    }

    if (!pickupLocation || !pickupLocation.trim()) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Pickup location is required",
      });
    }

    if (!dropoffLocation || !dropoffLocation.trim()) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Drop-off location is required",
      });
    }

    const parsedFare = parseFloat(fareTotal);
    if (isNaN(parsedFare) || parsedFare <= 0) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Valid fare amount is required",
      });
    }

    const parsedPassengers = parseInt(passengers);
    if (isNaN(parsedPassengers) || parsedPassengers < 1) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Valid number of passengers is required",
      });
    }

    // Create driver-generated client
    const client = await Client.create({
      name: clientName.trim(),
      createdBy: req.user.id,
      isDriverAdded: true,
    });

    // Create driver-generated destinations
    const fromDest = await Destination.create({
      name: pickupLocation.trim(),
      address: pickupLocation.trim(),
      createdBy: req.user.id,
      isDriverGenerated: true,
    });

    const toDest = await Destination.create({
      name: dropoffLocation.trim(),
      address: dropoffLocation.trim(),
      createdBy: req.user.id,
      isDriverGenerated: true,
    });

    // Calculate GST and fare breakdown
    const gst = await calculateGST(parsedFare);
    const perPersonFare = parseFloat(
      (parsedFare / parsedPassengers).toFixed(2)
    );
    const halfFare = parseFloat((perPersonFare / 2).toFixed(2));

    // Create the ride
    const ride = await Ride.create({
      rideId: await genRideId(),
      isSelfAssigned: true,
      clients: [client._id],
      from: fromDest._id,
      to: toDest._id,
      scheduledTime: scheduledTime || new Date(),
      passengers: parsedPassengers,
      fare: {
        total: parsedFare,
        perPerson: perPersonFare,
        halfFare: halfFare,
        gst: gst,
      },
      driver: req.user.id,
      shift: activeShift._id,
      status: "accepted", // Self-assigned rides start as accepted
      driverNotes: driverNotes?.trim() || "",
      acceptedAt: new Date(),
    });

    // Update driver status to ON_RIDE
    await User.findByIdAndUpdate(req.user.id, {
      status: DRIVER_STATUS.ON_RIDE,
    });

    const populated = await Ride.findById(ride._id)
      .populate("driver", "fullName phone username")
      .populate("clients", "name phone")
      .populate("from to", "name address")
      .populate("shift");

    // Notify admins about self-assigned ride
    await notifyAdmins("self_assigned_ride", {
      rideId: ride.rideId,
      driverName: req.user.fullName || req.user.username,
      clientName: clientName.trim(),
    });

    res.status(201).json({
      success: true,
      message: "Self-assigned ride created successfully",
      ride: populated,
    });
  } catch (e) {
    next(e);
  }
}

module.exports = {
  assignRide,
  listRides,
  getDriverRides,
  updateRideStatus,
  reassignRide,
  getAvailableClients,
  getAvailableDrivers,
  getAllDestinations,
  acceptRide,
  rejectRide,
  startRide,
  dropRide,
  cancelOngoingRide,
  updateRideDestinations,
  // Scheduled bookings
  createScheduledBooking,
  listScheduledBookings,
  assignScheduledBooking,
  deleteScheduledBooking,
  updateScheduledBooking,
  // Manager abort
  abortRide,
  // Quick trips
  createQuickTrip,
  completeQuickTripDetails,
  // Self-assigned rides
  createSelfAssignedRide,
};
