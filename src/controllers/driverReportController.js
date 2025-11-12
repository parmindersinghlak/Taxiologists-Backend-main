/**
 * Driver Report Controller
 * Handles all driver report CRUD operations and business logic
 */
const mongoose = require("mongoose");
const DriverReport = require("../models/DriverReport");
const Ride = require("../models/Ride");
const User = require("../models/User");
const Shift = require("../models/Shift"); // <-- NEW
const {
  calculateReportTotals,
  validateCalculations,
  calculateReconciliation,
} = require("../services/reportCalculationService");
const {
  uploadReportPhoto: uploadPhotoToStorage,
  deleteReportPhoto,
  validatePhotoUrl,
} = require("../services/photoUploadService");

/**
 * ADMIN LIST
 * GET /api/driver-reports
 * Role: admin | manager
 */
async function listReports(req, res, next) {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      driverId,
      startDate,
      endDate,
      search,
      sortBy = "date",
      sortOrder = "desc",
    } = req.query;

    const filter = {};
    if (status) {
      const normalized =
        String(status).toLowerCase() === "pending"
          ? "submitted"
          : String(status).toLowerCase();
      filter.status = normalized;
    }
    if (driverId) filter.driver = driverId;
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }

    const or = [];
    if (search) {
      const rx = new RegExp(search, "i");
      or.push({ reportId: rx });
      or.push({ taxiNumber: rx });
    }

    const query = or.length ? { $and: [filter, { $or: or }] } : filter;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortDirection = sortOrder === "desc" ? -1 : 1;

    const [reports, totalCount] = await Promise.all([
      DriverReport.find(query)
        .populate("driver", "fullName username")
        .populate("reviewedBy", "fullName")
        .sort({ [sortBy]: sortDirection })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      DriverReport.countDocuments(query),
    ]);

    const totalPages = Math.ceil(totalCount / parseInt(limit));
    res.json({
      success: true,
      reports,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalReports: totalCount,
        hasNextPage: parseInt(page) < totalPages,
        hasPrevPage: parseInt(page) > 1,
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/driver-reports
 * Create new driver report
 * Role: driver
 */
async function createDriverReport(req, res, next) {
  try {
    const driverId = req.user.id;
    let { date, taxiNumber, shift: shiftId, ...reportData } = req.body;

    // If shiftId is provided, use that shift (even if not active anymore)
    // Otherwise, require an active shift
    let targetShift = null;
    if (shiftId) {
      targetShift = await Shift.findOne({ _id: shiftId, driver: driverId });
      if (!targetShift) {
        return res.status(400).json({
          success: false,
          code: "INVALID_SHIFT",
          message: "Shift not found or does not belong to you",
        });
      }
    } else {
      targetShift = await Shift.findOne({ driver: driverId, isActive: true });
      if (!targetShift) {
        return res.status(400).json({
          success: false,
          code: "NO_ACTIVE_SHIFT",
          message: "Please start a shift before creating a report",
        });
      }
    }

    // default taxiNumber/date from shift if not provided
    if (!taxiNumber) taxiNumber = targetShift.taxiNumber;
    if (!date) date = new Date(targetShift.startTime).toISOString().split("T")[0];

    if (!date || !taxiNumber) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Date and taxi number are required",
      });
    }

    const reportDate = new Date(date);
    if (isNaN(reportDate.getTime())) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Invalid date format",
      });
    }

    // Check duplicate for this specific shift (not just the date)
    // A driver can have multiple shifts per day, so check by shift ID
    const existingReport = await DriverReport.findOne({
      driver: driverId,
      shift: targetShift._id,
    });

    if (existingReport) {
      return res.status(409).json({
        success: false,
        code: "REPORT_EXISTS",
        message: "A report for this shift already exists",
        existingReportId: existingReport.reportId,
      });
    }

    const startOfDay = new Date(reportDate.toDateString());
    const endOfDay = new Date(reportDate.getTime() + 24 * 60 * 60 * 1000);

    const associatedRides = await Ride.find({
      driver: driverId,
      status: "completed",
      scheduledTime: { $gte: startOfDay, $lt: endOfDay },
    }).populate("from to clients");

    const newReport = new DriverReport({
      driver: driverId,
      date: reportDate,
      taxiNumber: String(taxiNumber).trim(),
      associatedRides: associatedRides.map((ride) => ride._id),
      status: "draft",
      shift: targetShift._id, // <-- link shift
      ...reportData,
    });

    // Pre-calc only if both meter totals present
    if (newReport.shiftStartTotal?.amount && newReport.shiftEndTotal?.amount) {
      const calculations = await calculateReportTotals(newReport);
      newReport.calculations = calculations;
    }

    await newReport.save();
    await newReport.populate("driver", "fullName username");

    res.status(201).json({
      success: true,
      message: "Driver report created successfully",
      report: newReport,
      associatedRidesCount: associatedRides.length,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => ({
        field: err.path,
        message: err.message,
        value: err.value,
      }));
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Invalid report data",
        errors,
      });
    }

    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        code: "DUPLICATE_REPORT",
        message: "Report already exists",
        details: error.keyPattern,
      });
    }

    next(error);
  }
}

/**
 * GET /api/driver-reports/my-reports
 * Get driver's own reports
 * Role: driver
 */
async function getMyReports(req, res, next) {
  try {
    const driverId = req.user.id;
    const {
      page = 1,
      limit = 20,
      status,
      startDate,
      endDate,
      sortBy = "date",
      sortOrder = "desc",
    } = req.query;

    const filter = { driver: driverId };
    if (status) filter.status = status;
    if (startDate || endDate) {
      filter.date = {};
      if (startDate) filter.date.$gte = new Date(startDate);
      if (endDate) filter.date.$lte = new Date(endDate);
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const sortDirection = sortOrder === "desc" ? -1 : 1;

    const [reports, totalCount] = await Promise.all([
      DriverReport.find(filter)
        .populate("driver", "fullName username")
        .populate("reviewedBy", "fullName")
        .sort({ [sortBy]: sortDirection })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      DriverReport.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.json({
      success: true,
      reports,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalReports: totalCount,
        hasNextPage: parseInt(page) < totalPages,
        hasPrevPage: parseInt(page) > 1,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/driver-reports/:reportId
 * Get specific report details
 * Role: driver (own) | admin | manager
 */
async function getReportById(req, res, next) {
  try {
    const { reportId } = req.params;
    const userId = req.user.id;
    const userRole = req.user.role;

    const report = await DriverReport.findOne({ reportId })
      .populate("driver", "fullName username phone")
      .populate("reviewedBy", "fullName")
      .populate("associatedRides");

    if (!report) {
      return res
        .status(404)
        .json({ success: false, code: "REPORT_NOT_FOUND", message: "Driver report not found" });
    }

    if (userRole === "driver" && report.driver._id.toString() !== userId) {
      return res
        .status(403)
        .json({ success: false, code: "ACCESS_DENIED", message: "You can only view your own reports" });
    }

    const reconciliation = await calculateReconciliation(report, report.associatedRides);
    res.json({ success: true, report, reconciliation });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/driver-reports/:reportId
 * Update draft report (driver)
 */
async function updateDriverReport(req, res, next) {
  try {
    const { reportId } = req.params;
    const driverId = req.user.id;
    const updateData = req.body;

    const report = await DriverReport.findOne({ reportId, driver: driverId });
    if (!report) {
      return res
        .status(404)
        .json({ success: false, code: "REPORT_NOT_FOUND", message: "Driver report not found" });
    }

    if (!report.canEdit()) {
      return res.status(400).json({
        success: false,
        code: "REPORT_NOT_EDITABLE",
        message: `Cannot edit report with status: ${report.status}`,
      });
    }

    const allowedFields = [
      "taxiNumber",
      "shiftStartTotal",
      "shiftEndTotal",
      "liftings",
      "cashFares",
      "totalEFTPOS",
      "totalAccountTrips",
      "cashExpenses",
      "totalTripsCount",
      "notes",
    ];

    allowedFields.forEach((field) => {
      if (updateData[field] !== undefined) report[field] = updateData[field];
    });

    if (
      updateData.shiftStartTotal ||
      updateData.shiftEndTotal ||
      updateData.liftings ||
      updateData.cashFares ||
      updateData.totalEFTPOS ||
      updateData.totalAccountTrips ||
      updateData.cashExpenses ||
      updateData.totalTripsCount
    ) {
      const calculations = await calculateReportTotals(report);
      const validation = validateCalculations(calculations, report);

      if (!validation.isValid) {
        return res.status(400).json({
          success: false,
          code: "CALCULATION_ERROR",
          message: "Invalid calculation data",
          errors: validation.errors,
        });
      }

      report.calculations = calculations;
    }

    await report.save();
    await report.populate("driver", "fullName username");

    res.json({ success: true, message: "Driver report updated successfully", report });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Invalid report data",
        errors: Object.keys(error.errors).map((key) => ({
          field: key,
          message: error.errors[key].message,
        })),
      });
    }
    next(error);
  }
}

/**
 * POST /api/driver-reports/:reportId/submit
 * Submit draft for review (driver)
 */
async function submitReport(req, res, next) {
  try {
    const { reportId } = req.params;
    const driverId = req.user.id;

    const report = await DriverReport.findOne({ reportId, driver: driverId });
    if (!report) {
      return res
        .status(404)
        .json({ success: false, code: "REPORT_NOT_FOUND", message: "Driver report not found" });
    }

    if (report.status !== "draft") {
      return res.status(400).json({
        success: false,
        code: "INVALID_STATUS",
        message: `Cannot submit report with status: ${report.status}`,
      });
    }

    if (!report.canSubmit()) {
      return res.status(400).json({
        success: false,
        code: "REPORT_INCOMPLETE",
        message:
          "Report is incomplete. Please ensure all required photos are uploaded and data is valid.",
      });
    }

    const calculations = await calculateReportTotals(report);
    const validation = validateCalculations(calculations, report);

    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        code: "CALCULATION_ERROR",
        message: "Report contains calculation errors",
        errors: validation.errors,
      });
    }

    report.status = "submitted";
    report.calculations = calculations;
    report.submittedAt = new Date();

    await report.save();
    await report.populate("driver", "fullName username");

    res.json({ success: true, message: "Driver report submitted successfully", report });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/driver-reports/:reportId/photos
 * Upload photo (driver)
 */
async function uploadReportPhoto(req, res, next) {
  try {
    const { reportId } = req.params;
    const { photoType } = req.body;
    const driverId = req.user.id;
    const file = req.file;

    if (!file) return res.status(400).json({ success: false, code: "NO_FILE", message: "No photo file provided" });
    if (!photoType)
      return res
        .status(400)
        .json({
          success: false,
          code: "NO_PHOTO_TYPE",
          message: "Photo type is required (meter_start, meter_end, eftpos, expense)",
        });

    const report = await DriverReport.findOne({ reportId, driver: driverId });
    if (!report)
      return res.status(404).json({ success: false, code: "REPORT_NOT_FOUND", message: "Driver report not found" });

    if (!report.canEdit()) {
      return res.status(400).json({
        success: false,
        code: "REPORT_NOT_EDITABLE",
        message: `Cannot upload photos to report with status: ${report.status}`,
      });
    }

    const photoUrl = await uploadPhotoToStorage(file, reportId, photoType, driverId);

    let oldPhotoUrl = null;
    switch (photoType) {
      case "meter_start":
        oldPhotoUrl = report.shiftStartTotal.photoUrl;
        report.shiftStartTotal.photoUrl = photoUrl;
        break;
      case "meter_end":
        oldPhotoUrl = report.shiftEndTotal.photoUrl;
        report.shiftEndTotal.photoUrl = photoUrl;
        break;
      case "eftpos":
        oldPhotoUrl = report.totalEFTPOS.photoUrl;
        report.totalEFTPOS.photoUrl = photoUrl;
        break;
      case "expense":
        oldPhotoUrl = report.cashExpenses.photoUrl;
        report.cashExpenses.photoUrl = photoUrl;
        break;
      default:
        return res.status(400).json({ success: false, code: "INVALID_PHOTO_TYPE", message: "Invalid photo type" });
    }

    if (oldPhotoUrl) await deleteReportPhoto(oldPhotoUrl);

    await report.save();

    res.json({ success: true, message: "Photo uploaded successfully", photoUrl, photoType });
  } catch (error) {
    next(error);
  }
}

/**
 * PATCH /api/driver-reports/:reportId/photos
 * Update photo URL from Supabase (driver)
 * Accepts JSON body with photoType and photoUrl
 */
async function updateReportPhotoUrl(req, res, next) {
  try {
    const { reportId } = req.params;
    const { photoType, photoUrl } = req.body;
    const driverId = req.user.id;

    if (!photoType || !photoUrl) {
      return res.status(400).json({
        success: false,
        code: "MISSING_FIELDS",
        message: "photoType and photoUrl are required",
      });
    }

    // Validate photo type
    const validPhotoTypes = ["meter_start", "meter_end", "eftpos", "expense"];
    if (!validPhotoTypes.includes(photoType)) {
      return res.status(400).json({
        success: false,
        code: "INVALID_PHOTO_TYPE",
        message: "Invalid photo type. Must be: meter_start, meter_end, eftpos, or expense",
      });
    }

    // Find report
    const report = await DriverReport.findOne({ reportId, driver: driverId });
    if (!report) {
      return res.status(404).json({
        success: false,
        code: "REPORT_NOT_FOUND",
        message: "Driver report not found",
      });
    }

    // Check if report is editable
    if (!report.canEdit()) {
      return res.status(400).json({
        success: false,
        code: "REPORT_NOT_EDITABLE",
        message: `Cannot upload photos to report with status: ${report.status}`,
      });
    }

    // Update the appropriate photo URL
    switch (photoType) {
      case "meter_start":
        report.shiftStartTotal.photoUrl = photoUrl;
        break;
      case "meter_end":
        report.shiftEndTotal.photoUrl = photoUrl;
        break;
      case "eftpos":
        report.totalEFTPOS.photoUrl = photoUrl;
        break;
      case "expense":
        report.cashExpenses.photoUrl = photoUrl;
        break;
    }

    await report.save();

    res.json({
      success: true,
      message: "Photo URL saved successfully",
      photoUrl,
      photoType,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/driver-reports/admin/pending
 * Role: admin | manager
 */
async function getPendingReports(req, res, next) {
  try {
    const { page = 1, limit = 20 } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [reports, totalCount] = await Promise.all([
      DriverReport.findPendingReports().skip(skip).limit(parseInt(limit)),
      DriverReport.countDocuments({ status: "submitted" }),
    ]);

    const totalPages = Math.ceil(totalCount / parseInt(limit));

    res.json({
      success: true,
      reports,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalReports: totalCount,
        hasNextPage: parseInt(page) < totalPages,
        hasPrevPage: parseInt(page) > 1,
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * PUT /api/driver-reports/:reportId/review
 * Approve or reject (admin | manager)
 */
async function reviewReport(req, res, next) {
  try {
    const { reportId } = req.params;
    const { action, notes } = req.body;
    const reviewerId = req.user.id;

    if (!["approve", "reject"].includes(action)) {
      return res
        .status(400)
        .json({ success: false, code: "INVALID_ACTION", message: "Action must be 'approve' or 'reject'" });
    }

    const report = await DriverReport.findOne({ reportId }).populate(
      "driver",
      "fullName username email phone"
    );
    if (!report)
      return res.status(404).json({ success: false, code: "REPORT_NOT_FOUND", message: "Driver report not found" });
    if (report.status !== "submitted") {
      return res
        .status(400)
        .json({ success: false, code: "INVALID_STATUS", message: `Cannot review report with status: ${report.status}` });
    }

    report.status = action === "approve" ? "approved" : "rejected";
    report.reviewedBy = reviewerId;
    report.reviewedAt = new Date();
    report.reviewNotes = notes || "";
    if (action === "reject") report.rejectionReason = notes || "No reason provided";

    await report.save();
    await report.populate("reviewedBy", "fullName");

    res.json({ success: true, message: `Report ${action}d successfully`, report });
  } catch (error) {
    next(error);
  }
}

/**
 * DELETE /api/driver-reports/:reportId
 * Delete draft (driver)
 */
async function deleteReport(req, res, next) {
  try {
    const { reportId } = req.params;
    const driverId = req.user.id;

    const report = await DriverReport.findOne({ reportId, driver: driverId });
    if (!report) return res.status(404).json({ success: false, code: "REPORT_NOT_FOUND", message: "Driver report not found" });

    if (report.status !== "draft") {
      return res.status(400).json({
        success: false,
        code: "REPORT_NOT_DELETABLE",
        message: `Cannot delete report with status: ${report.status}`,
      });
    }

    const photosToDelete = [
      report.shiftStartTotal?.photoUrl,
      report.shiftEndTotal?.photoUrl,
      report.totalEFTPOS?.photoUrl,
      report.cashExpenses?.photoUrl,
    ].filter(Boolean);

    await Promise.all(photosToDelete.map((photoUrl) => deleteReportPhoto(photoUrl)));
    await DriverReport.deleteOne({ _id: report._id });

    res.json({ success: true, message: "Driver report deleted successfully" });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  listReports,
  createDriverReport,
  getMyReports,
  getReportById,
  updateDriverReport,
  submitReport,
  uploadReportPhoto,
  updateReportPhotoUrl,
  getPendingReports,
  reviewReport,
  deleteReport,
};
