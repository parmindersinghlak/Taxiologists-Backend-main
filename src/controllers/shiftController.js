// src/controllers/shiftController.js
const Shift = require('../models/Shift');
const User = require('../models/User');
const Ride = require('../models/Ride');
const { notifyAdminsAndManagers } = require('../services/notificationService');

/**
 * POST /api/shifts/start
 * fields: taxiNumber, startMeter
 * file: startMeterPhoto  (multer fields upload)
 */
exports.startShift = async (req, res) => {
  try {
    const driverId = req.user.id;
    const { taxiNumber, startMeter, startMeterPhoto } = req.body;

    if (!taxiNumber || typeof taxiNumber !== 'string') {
      return res.status(400).json({ success: false, message: 'taxiNumber is required' });
    }
    const startMeterNum = Number(startMeter);
    if (Number.isNaN(startMeterNum) || startMeterNum < 0) {
      return res.status(400).json({ success: false, message: 'startMeter must be a non-negative number' });
    }

    const existing = await Shift.findOne({ driver: driverId, isActive: true });
    if (existing) {
      return res.status(400).json({ success: false, message: 'You already have an active shift', data: existing });
    }

    // Support both file upload (legacy) and URL (Supabase)
    let photoUrl = startMeterPhoto; // From request body (Supabase URL)
    
    // Fallback to file upload if no URL provided
    if (!photoUrl) {
      const file = req?.files?.startMeterPhoto?.[0];
      if (file) {
        photoUrl = file.url || file.path || file.location || '';
      }
    }

    // Photo is optional now (can be updated later via PATCH)
    const shift = await Shift.create({
      driver: driverId,
      taxiNumber: taxiNumber.trim(),
      startMeter: startMeterNum,
      startMeterPhoto: photoUrl || 'pending',
      isActive: true,
    });

    // Get driver details for notification
    const driver = await User.findById(driverId).select('fullName');
    const startTime = shift.startTime.toLocaleString('en-AU', { 
      timeZone: 'Australia/Sydney',
      dateStyle: 'short',
      timeStyle: 'short'
    });

    // Notify all admins and managers
    await notifyAdminsAndManagers('shift_started', {
      shiftId: shift._id.toString(),
      driverId: driverId,
      driverName: driver?.fullName || 'Unknown Driver',
      taxiNumber: shift.taxiNumber,
      startTime: shift.startTime,
      timestamp: Date.now(),
      message: `${driver?.fullName || 'Driver'} started shift in Taxi ${shift.taxiNumber} at ${startTime}`
    });

    return res.status(201).json({ success: true, data: shift });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to start shift', error: err.message });
  }
};

/**
 * PATCH /api/shifts/:shiftId
 * Update shift details (e.g., photo URL from Supabase)
 */
exports.updateShift = async (req, res) => {
  try {
    const { shiftId } = req.params;
    const driverId = req.user.id;
    const { startMeterPhoto } = req.body;

    if (!startMeterPhoto) {
      return res.status(400).json({ 
        success: false, 
        message: 'startMeterPhoto URL is required' 
      });
    }

    const shift = await Shift.findOneAndUpdate(
      { _id: shiftId, driver: driverId },
      { startMeterPhoto },
      { new: true }
    );

    if (!shift) {
      return res.status(404).json({ 
        success: false, 
        message: 'Shift not found or you do not have permission' 
      });
    }

    return res.json({ success: true, data: shift });
  } catch (err) {
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to update shift', 
      error: err.message 
    });
  }
};

/**
 * POST /api/shifts/:shiftId/end
 */
exports.endShift = async (req, res) => {
  try {
    const { shiftId } = req.params;
    const driverId = req.user.id;

    const shift = await Shift.findOneAndUpdate(
      { _id: shiftId, driver: driverId, isActive: true },
      { isActive: false, endTime: new Date() },
      { new: true }
    );

    if (!shift) {
      return res.status(404).json({ success: false, message: 'Active shift not found' });
    }

    // Get driver details for notification
    const driver = await User.findById(driverId).select('fullName');
    const endTime = shift.endTime.toLocaleString('en-AU', { 
      timeZone: 'Australia/Sydney',
      dateStyle: 'short',
      timeStyle: 'short'
    });

    // Calculate duration
    const durationMs = shift.endTime - shift.startTime;
    const hours = Math.floor(durationMs / (1000 * 60 * 60));
    const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
    const durationStr = `${hours}h ${minutes}m`;

    // Notify all admins and managers
    await notifyAdminsAndManagers('shift_ended', {
      shiftId: shift._id.toString(),
      driverId: driverId,
      driverName: driver?.fullName || 'Unknown Driver',
      taxiNumber: shift.taxiNumber,
      startTime: shift.startTime,
      endTime: shift.endTime,
      duration: durationStr,
      durationMs: durationMs,
      timestamp: Date.now(),
      message: `${driver?.fullName || 'Driver'} ended shift in Taxi ${shift.taxiNumber} at ${endTime} (Duration: ${durationStr})`
    });

    return res.json({ success: true, data: shift });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to end shift', error: err.message });
  }
};

/**
 * GET /api/shifts/current
 */
exports.getCurrentShift = async (req, res) => {
  try {
    const driverId = req.user.id;
    const shift = await Shift.findOne({ driver: driverId, isActive: true });

    // Return 200 with null data (simpler mobile handling)
    return res.json({ success: true, data: shift });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to get current shift', error: err.message });
  }
};

/**
 * GET /api/shifts/timeline
 * Query params: driverId (optional), date (optional, format: YYYY-MM-DD)
 * Admin/Manager only - view shift timeline for any driver and date
 */
exports.getShiftTimeline = async (req, res) => {
  try {
    const { driverId, date } = req.query;
    
    let query = {};
    
    // Filter by driver if provided
    if (driverId) {
      query.driver = driverId;
    }
    
    // Filter by date if provided (UTC-safe)
    if (date) {
      // Expecting YYYY-MM-DD from frontend. Build explicit UTC range.
      const startOfDay = new Date(`${date}T00:00:00.000Z`);
      const endOfDay = new Date(`${date}T23:59:59.999Z`);

      if (isNaN(startOfDay.getTime()) || isNaN(endOfDay.getTime())) {
        return res.status(400).json({ success: false, message: 'Invalid date format. Expected YYYY-MM-DD' });
      }
      
      query.$or = [
        // Shifts that started on this day
        { startTime: { $gte: startOfDay, $lte: endOfDay } },
        // Shifts that ended on this day
        { endTime: { $gte: startOfDay, $lte: endOfDay } },
        // Shifts that span across this day
        { 
          startTime: { $lt: startOfDay },
          $or: [
            { endTime: { $gt: endOfDay } },
            { endTime: null, isActive: true }
          ]
        }
      ];
    }
    
    const shifts = await Shift.find(query)
      .populate('driver', 'fullName username phone')
      .sort({ startTime: -1 })
      .lean();
    
    // Calculate duration for each shift
    const shiftsWithDuration = shifts.map(shift => {
      let duration = null;
      let durationMs = null;
      
      if (shift.endTime) {
        durationMs = new Date(shift.endTime) - new Date(shift.startTime);
        const hours = Math.floor(durationMs / (1000 * 60 * 60));
        const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
        duration = `${hours}h ${minutes}m`;
      }
      
      return {
        ...shift,
        duration,
        durationMs
      };
    });
    
    return res.json({ 
      success: true, 
      data: shiftsWithDuration,
      count: shiftsWithDuration.length
    });
  } catch (err) {
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch shift timeline', 
      error: err.message 
    });
  }
};

/**
 * GET /api/shifts/driver/:driverId/history
 * Get all shifts for a specific driver (paginated)
 * Admin/Manager only
 */
exports.getDriverShiftHistory = async (req, res) => {
  try {
    const { driverId } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;
    
    const query = { driver: driverId };
    
    const [shifts, total] = await Promise.all([
      Shift.find(query)
        .populate('driver', 'fullName username')
        .sort({ startTime: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Shift.countDocuments(query)
    ]);
    
    // Calculate duration for each shift
    const shiftsWithDuration = shifts.map(shift => {
      let duration = null;
      let durationMs = null;
      
      if (shift.endTime) {
        durationMs = new Date(shift.endTime) - new Date(shift.startTime);
        const hours = Math.floor(durationMs / (1000 * 60 * 60));
        const minutes = Math.floor((durationMs % (1000 * 60 * 60)) / (1000 * 60));
        duration = `${hours}h ${minutes}m`;
      }
      
      return {
        ...shift,
        duration,
        durationMs
      };
    });
    
    return res.json({ 
      success: true, 
      data: shiftsWithDuration,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (err) {
    return res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch driver shift history', 
      error: err.message 
    });
  }
};

/**
 * GET /api/shifts/:shiftId/ride-statistics
 * Get ride statistics for a specific shift
 * Returns: totalTripsCount and totalAccountTrips (sum of completed ride fares)
 */
exports.getShiftRideStatistics = async (req, res) => {
  try {
    const { shiftId } = req.params;
    const driverId = req.user.id;

    // Verify shift belongs to the driver
    const shift = await Shift.findOne({ _id: shiftId, driver: driverId });
    if (!shift) {
      return res.status(404).json({ 
        success: false, 
        message: 'Shift not found or does not belong to you' 
      });
    }

    // Find all completed rides for this shift
    const completedRides = await Ride.find({
      shift: shiftId,
      driver: driverId,
      status: 'completed'
    }).select('fare').lean();

    // Calculate statistics
    const totalTripsCount = completedRides.length;
    const totalAccountTrips = completedRides.reduce((sum, ride) => {
      return sum + (ride.fare?.total || 0);
    }, 0);

    return res.json({
      success: true,
      data: {
        shiftId,
        totalTripsCount,
        totalAccountTrips: parseFloat(totalAccountTrips.toFixed(2))
      }
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch ride statistics',
      error: err.message
    });
  }
};
