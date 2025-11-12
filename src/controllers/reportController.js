const mongoose = require("mongoose");
const Ride = require("../models/Ride");
const User = require("../models/User");
const Client = require("../models/Client");
const { stringify } = require("csv-stringify"); 
const { calculateGST } = require("./settingsController");
const ExcelJS = require("exceljs");

// Parse "YYYY-MM" -> { start: Date, end: Date }
function monthRange(yyyyMm) {
  if (!/^\d{4}-\d{2}$/.test(yyyyMm || "")) {
    const err = new Error("Query param 'month' must be in format YYYY-MM");
    err.status = 400;
    err.code = "VALIDATION_ERROR";
    throw err;
  }
  const [y, m] = yyyyMm.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const end = new Date(
    Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 0, 0, 0, 0)
  );
  return { start, end };
}

// Format for CSV: "YYYY-MM-DD HH:mm"
function fmtCsv(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

/** Build a normalized ride row so both endpoints share identical mapping. */
function mapRide(r) {
  const scheduledDate = new Date(r.scheduledTime);
  const clientNames = r.clients?.map((c) => c.name).join(", ") || "";
  return {
    date: scheduledDate.toLocaleDateString("en-AU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }),
    time: scheduledDate.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }),
    passengers: clientNames,
    from: r.from?.name || "",
    to: r.to?.name || "",
    fullFare: Number(r.fare?.total || 0), // <-- source of truth
    // NOTE: we still compute halfFare for JSON API compatibility, but we never export it to CSV.
    halfFare: Number(r.fare?.halfFare || 0),
    farePerPerson: Number(r.fare?.perPerson || 0),
    gst: Number(r.fare?.gst || 0),
    driverNotes: r.driverNotes || "",
    driverName: r.driver?.fullName || "",
    // ⬇️ NEW: carry through actual start/end timestamps
    startedAt: r.startedAt || null,
    droppedAt: r.droppedAt || null,
  };
}

/**
 * GET /api/reports/driver-earnings/:driverId/download-excel?month=YYYY-MM
 * Roles: admin | manager
 * Downloads driver earnings report as Excel file.
 */
async function downloadDriverEarningsExcel(req, res, next) {
  try {
    const { driverId } = req.params;
    const { month } = req.query;

    if (!mongoose.Types.ObjectId.isValid(driverId)) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Invalid driverId",
      });
    }
    const driver = await User.findById(driverId, "fullName role");
    if (!driver || driver.role !== "driver") {
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Driver not found",
      });
    }

    const { start, end } = monthRange(month);

    // Aggregate totals
    const summary = await Ride.aggregate([
      {
        $match: {
          driver: new mongoose.Types.ObjectId(driverId),
          status: "completed",
          scheduledTime: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: null,
          totalRides: { $sum: 1 },
          totalEarnings: { $sum: "$fare.total" },
          totalGST: { $sum: { $ifNull: ["$fare.gst", 0] } },
        },
      },
    ]);

    const totals = summary[0] || {
      totalRides: 0,
      totalEarnings: 0,
      totalGST: 0,
    };

    // Detailed list
    const rides = await Ride.find({
      driver: driverId,
      status: "completed",
      scheduledTime: { $gte: start, $lt: end },
    })
      .sort({ scheduledTime: 1 })
      .populate("from", "name")
      .populate("to", "name")
      .populate("clients", "name")
      .populate("driver", "fullName")
      .select({
        rideId: 1,
        scheduledTime: 1,
        startedAt: 1,
        droppedAt: 1,
        fare: 1,
        passengers: 1,
        driverNotes: 1,
        from: 1,
        to: 1,
        clients: 1,
        driver: 1,
      })
      .lean();

    const rideRows = rides.map(mapRide);

    // Generate Excel workbook
    const workbook = await generateDriverExcel(driverId, month, driver, totals, rideRows);

    // Set response headers
    const filename = `driver-earnings-${driver.fullName.replace(/[^a-zA-Z0-9]/g, "_")}-${month}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    // Write to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (e) {
    next(e);
  }
}

/**
 * GET /api/reports/driver-earnings/:driverId/download?month=YYYY-MM
 * Roles: admin | manager
 * Downloads driver earnings report as CSV file.
 */
async function downloadDriverEarnings(req, res, next) {
  try {
    const { driverId } = req.params;
    const { month } = req.query;

    if (!mongoose.Types.ObjectId.isValid(driverId)) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Invalid driverId",
      });
    }
    const driver = await User.findById(driverId, "fullName role");
    if (!driver || driver.role !== "driver") {
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Driver not found",
      });
    }

    const { start, end } = monthRange(month);

    // Aggregate totals
    const summary = await Ride.aggregate([
      {
        $match: {
          driver: new mongoose.Types.ObjectId(driverId),
          status: "completed",
          scheduledTime: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: null,
          totalRides: { $sum: 1 },
          totalEarnings: { $sum: "$fare.total" },
          totalGST: { $sum: { $ifNull: ["$fare.gst", 0] } },
        },
      },
    ]);

    const totals = summary[0] || {
      totalRides: 0,
      totalEarnings: 0,
      totalGST: 0,
    };

    // Detailed list
    const rides = await Ride.find({
      driver: driverId,
      status: "completed",
      scheduledTime: { $gte: start, $lt: end },
    })
      .sort({ scheduledTime: 1 })
      .populate("from", "name")
      .populate("to", "name")
      .populate("clients", "name")
      .populate("driver", "fullName")
      .select({
        rideId: 1,
        scheduledTime: 1,
        startedAt: 1,    
        droppedAt: 1,     
        fare: 1,
        passengers: 1,
        driverNotes: 1,
        from: 1,
        to: 1,
        clients: 1,
        driver: 1,
      })
      .lean();

    const rideRows = rides.map(mapRide);

    // Prepare CSV data — now includes Start Time & End Time columns
    const csvData = [
      ["Driver Earnings Report"],
      ["Driver Name", driver.fullName],
      ["Month", month],
      ["Total Rides", totals.totalRides],
      ["Total Earnings", `$${Number(totals.totalEarnings || 0).toFixed(2)}`],
      ["Total GST", `$${Number(totals.totalGST || 0).toFixed(2)}`],
      [""],
      // Headers: single "Half Fare" (mapped from fullFare), plus Start/End Time
      [
        "Date",
        "Time",
        "Start Time",
        "End Time",
        "Passengers",
        "From",
        "To",
        "Half Fare",
        "Fare Per Person",
        "GST",
        "Driver Notes",
      ],
      ...rideRows.map((row) => [
        row.date,
        row.time,
        fmtCsv(row.startedAt),
        fmtCsv(row.droppedAt),
        row.passengers,
        row.from,
        row.to,
        `$${row.fullFare.toFixed(2)}`, // mapped to header "Half Fare"
        `$${row.farePerPerson.toFixed(2)}`,
        `$${row.gst.toFixed(2)}`,
        row.driverNotes,
      ]),
    ];

    stringify(csvData, (err, csvString) => {
      if (err) return next(err);

      const filename = `driver-earnings-${driver.fullName.replace(/[^a-zA-Z0-9]/g, "_")}-${month}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csvString);
    });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /api/reports/driver-earnings/:driverId?month=YYYY-MM
 * Roles: admin | manager
 * JSON response
 */
async function getDriverEarnings(req, res, next) {
  try {
    const { driverId } = req.params;
    const { month } = req.query;

    if (!mongoose.Types.ObjectId.isValid(driverId)) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Invalid driverId",
      });
    }
    const driver = await User.findById(driverId, "fullName role");
    if (!driver || driver.role !== "driver") {
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Driver not found",
      });
    }

    const { start, end } = monthRange(month);

    const summary = await Ride.aggregate([
      {
        $match: {
          driver: new mongoose.Types.ObjectId(driverId),
          status: "completed",
          scheduledTime: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: null,
          totalRides: { $sum: 1 },
          totalEarnings: { $sum: "$fare.total" },
          totalGST: { $sum: { $ifNull: ["$fare.gst", 0] } },
        },
      },
    ]);

    const totals = summary[0] || {
      totalRides: 0,
      totalEarnings: 0,
      totalGST: 0,
    };

    const rides = await Ride.find({
      driver: driverId,
      status: "completed",
      scheduledTime: { $gte: start, $lt: end },
    })
      .sort({ scheduledTime: 1 })
      .populate("from", "name")
      .populate("to", "name")
      .populate("clients", "name")
      .populate("driver", "fullName")
      .select({
        rideId: 1,
        scheduledTime: 1,
        startedAt: 1,     // ⬅️ NEW
        droppedAt: 1,     // ⬅️ NEW
        fare: 1,
        passengers: 1,
        driverNotes: 1,
        from: 1,
        to: 1,
        clients: 1,
        driver: 1,
      })
      .lean();

    const rideRows = rides.map(mapRide);

    return res.json({
      success: true,
      earnings: {
        driverId: driver._id.toString(),
        driverName: driver.fullName,
        month,
        totalRides: totals.totalRides,
        totalEarnings: Number(totals.totalEarnings || 0),
        totalGST: Number(totals.totalGST || 0),
        rides: rideRows,
      },
    });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /api/reports/monthly/:month
 * Roles: admin | manager
 * JSON response
 */
async function getMonthlyReport(req, res, next) {
  try {
    const { month } = req.params;
    const { start, end } = monthRange(month);

    const summary = await Ride.aggregate([
      {
        $match: {
          status: "completed",
          scheduledTime: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: null,
          totalRides: { $sum: 1 },
          totalEarnings: { $sum: "$fare.total" },
          totalGST: { $sum: { $ifNull: ["$fare.gst", 0] } },
        },
      },
    ]);

    const totals = summary[0] || {
      totalRides: 0,
      totalEarnings: 0,
      totalGST: 0,
    };

    const rides = await Ride.find({
      status: "completed",
      scheduledTime: { $gte: start, $lt: end },
    })
      .sort({ scheduledTime: 1 })
      .populate("from", "name")
      .populate("to", "name")
      .populate("clients", "name")
      .populate("driver", "fullName")
      .select({
        rideId: 1,
        scheduledTime: 1,
        startedAt: 1,     // ⬅️ NEW
        droppedAt: 1,     // ⬅️ NEW
        fare: 1,
        passengers: 1,
        driverNotes: 1,
        from: 1,
        to: 1,
        clients: 1,
        driver: 1,
      })
      .lean();

    const rideRows = rides.map(mapRide);

    return res.json({
      success: true,
      report: {
        month,
        type: "monthly",
        totalRides: totals.totalRides,
        totalEarnings: Number(totals.totalEarnings || 0),
        totalGST: Number(totals.totalGST || 0),
        rides: rideRows,
      },
    });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /api/reports/monthly/:month/download-excel
 * Roles: admin | manager
 * Download monthly report Excel for all drivers
 */
async function downloadMonthlyReportExcel(req, res, next) {
  try {
    const { month } = req.params;
    const { start, end } = monthRange(month);

    // Build fresh data
    const summary = await Ride.aggregate([
      {
        $match: {
          status: "completed",
          scheduledTime: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: null,
          totalRides: { $sum: 1 },
          totalEarnings: { $sum: "$fare.total" },
          totalGST: { $sum: { $ifNull: ["$fare.gst", 0] } },
        },
      },
    ]);

    const totals = summary[0] || {
      totalRides: 0,
      totalEarnings: 0,
      totalGST: 0,
    };

    const rides = await Ride.find({
      status: "completed",
      scheduledTime: { $gte: start, $lt: end },
    })
      .sort({ scheduledTime: 1 })
      .populate("from", "name")
      .populate("to", "name")
      .populate("clients", "name")
      .populate("driver", "fullName")
      .select({
        rideId: 1,
        scheduledTime: 1,
        startedAt: 1,
        droppedAt: 1,
        fare: 1,
        passengers: 1,
        driverNotes: 1,
        from: 1,
        to: 1,
        clients: 1,
        driver: 1,
      })
      .lean();

    const rideRows = rides.map(mapRide);

    // Generate Excel workbook
    const workbook = await generateMonthlyExcel(month, totals, rideRows);

    // Set response headers
    const filename = `monthly-report-all-drivers-${month}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    // Write to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (e) {
    next(e);
  }
}

/**
 * GET /api/reports/monthly/:month/download
 * Roles: admin | manager
 * Download monthly report CSV for all drivers
 */
async function downloadMonthlyReport(req, res, next) {
  try {
    const { month } = req.params;
    const { start, end } = monthRange(month);

    // Build fresh data directly (do NOT call getMonthlyReport which writes to res)
    const summary = await Ride.aggregate([
      {
        $match: {
          status: "completed",
          scheduledTime: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: null,
          totalRides: { $sum: 1 },
          totalEarnings: { $sum: "$fare.total" },
          totalGST: { $sum: { $ifNull: ["$fare.gst", 0] } },
        },
      },
    ]);

    const totals = summary[0] || {
      totalRides: 0,
      totalEarnings: 0,
      totalGST: 0,
    };

    const rides = await Ride.find({
      status: "completed",
      scheduledTime: { $gte: start, $lt: end },
    })
      .sort({ scheduledTime: 1 })
      .populate("from", "name")
      .populate("to", "name")
      .populate("clients", "name")
      .populate("driver", "fullName")
      .select({
        rideId: 1,
        scheduledTime: 1,
        startedAt: 1,     // ⬅️ NEW
        droppedAt: 1,     // ⬅️ NEW
        fare: 1,
        passengers: 1,
        driverNotes: 1,
        from: 1,
        to: 1,
        clients: 1,
        driver: 1,
      })
      .lean();

    const rideRows = rides.map(mapRide);

    // Prepare CSV — single "Half Fare" column mapped from fullFare + Start/End Time
    const csvData = [
      ["Monthly Report - All Drivers"],
      ["Month", month],
      ["Total Rides", totals.totalRides],
      ["Total Earnings", `$${Number(totals.totalEarnings || 0).toFixed(2)}`],
      ["Total GST", `$${Number(totals.totalGST || 0).toFixed(2)}`],
      [""],
      [
        "Date",
        "Time",
        "Start Time",
        "End Time",
        "Passengers",
        "From",
        "To",
        "Half Fare",
        "Fare Per Person",
        "GST",
        "Driver Notes",
        "Driver Name",
      ],
      ...rideRows.map((row) => [
        row.date,
        row.time,
        fmtCsv(row.startedAt),
        fmtCsv(row.droppedAt),
        row.passengers,
        row.from,
        row.to,
        `$${row.fullFare.toFixed(2)}`, // mapped to header "Half Fare"
        `$${row.farePerPerson.toFixed(2)}`,
        `$${row.gst.toFixed(2)}`,
        row.driverNotes,
        row.driverName,
      ]),
    ];

    stringify(csvData, (err, csvString) => {
      if (err) return next(err);

      const filename = `monthly-report-all-drivers-${month}.csv`;
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csvString);
    });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /api/reports/client-trips/:clientId?month=YYYY-MM
 * Roles: admin | manager
 * JSON response for client trip reports
 */
async function getClientTrips(req, res, next) {
  try {
    const { clientId } = req.params;
    const { month } = req.query;

    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Invalid clientId",
      });
    }

    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Client not found",
      });
    }

    const { start, end } = monthRange(month);

    // Aggregate totals for this client
    const summary = await Ride.aggregate([
      {
        $match: {
          clients: new mongoose.Types.ObjectId(clientId),
          status: "completed",
          scheduledTime: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: null,
          totalRides: { $sum: 1 },
          totalEarnings: { $sum: "$fare.total" },
          totalGST: { $sum: { $ifNull: ["$fare.gst", 0] } },
        },
      },
    ]);

    const totals = summary[0] || {
      totalRides: 0,
      totalEarnings: 0,
      totalGST: 0,
    };

    // Get detailed rides for this client
    const rides = await Ride.find({
      clients: clientId,
      status: "completed",
      scheduledTime: { $gte: start, $lt: end },
    })
      .sort({ scheduledTime: 1 })
      .populate("from", "name")
      .populate("to", "name")
      .populate("clients", "name")
      .populate("driver", "fullName")
      .select({
        rideId: 1,
        scheduledTime: 1,
        startedAt: 1,
        droppedAt: 1,
        fare: 1,
        passengers: 1,
        driverNotes: 1,
        from: 1,
        to: 1,
        clients: 1,
        driver: 1,
      })
      .lean();

    const rideRows = rides.map(mapRide);

    return res.json({
      success: true,
      clientTrips: {
        clientId: client._id.toString(),
        clientName: client.name,
        month,
        totalRides: totals.totalRides,
        totalEarnings: Number(totals.totalEarnings || 0),
        totalGST: Number(totals.totalGST || 0),
        rides: rideRows,
      },
    });
  } catch (e) {
    next(e);
  }
}

/**
 * GET /api/reports/client-trips/:clientId/download?month=YYYY-MM
 * Roles: admin | manager
 * Downloads client trip report as Excel file
 */
async function downloadClientTrips(req, res, next) {
  try {
    const { clientId } = req.params;
    const { month } = req.query;

    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return res.status(400).json({
        success: false,
        code: "VALIDATION_ERROR",
        message: "Invalid clientId",
      });
    }

    const client = await Client.findById(clientId);
    if (!client) {
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Client not found",
      });
    }

    const { start, end } = monthRange(month);

    // Aggregate totals
    const summary = await Ride.aggregate([
      {
        $match: {
          clients: new mongoose.Types.ObjectId(clientId),
          status: "completed",
          scheduledTime: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: null,
          totalRides: { $sum: 1 },
          totalEarnings: { $sum: "$fare.total" },
          totalGST: { $sum: { $ifNull: ["$fare.gst", 0] } },
        },
      },
    ]);

    const totals = summary[0] || {
      totalRides: 0,
      totalEarnings: 0,
      totalGST: 0,
    };

    // Get detailed rides
    const rides = await Ride.find({
      clients: clientId,
      status: "completed",
      scheduledTime: { $gte: start, $lt: end },
    })
      .sort({ scheduledTime: 1 })
      .populate("from", "name")
      .populate("to", "name")
      .populate("clients", "name")
      .populate("driver", "fullName")
      .select({
        rideId: 1,
        scheduledTime: 1,
        startedAt: 1,
        droppedAt: 1,
        fare: 1,
        passengers: 1,
        driverNotes: 1,
        from: 1,
        to: 1,
        clients: 1,
        driver: 1,
      })
      .lean();

    const rideRows = rides.map(mapRide);

    // Create Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Client Trip Report");

    // Set column widths
    worksheet.columns = [
      { width: 12 }, // Date
      { width: 10 }, // Time
      { width: 18 }, // Start Time
      { width: 18 }, // End Time
      { width: 20 }, // Passengers
      { width: 20 }, // From
      { width: 20 }, // To
      { width: 12 }, // Half Fare
      { width: 15 }, // Fare Per Person
      { width: 10 }, // GST
      { width: 20 }, // Driver Name
      { width: 25 }, // Driver Notes
    ];

    // Title row
    worksheet.mergeCells("A1:L1");
    const titleCell = worksheet.getCell("A1");
    titleCell.value = "Client Trip Report";
    titleCell.font = { size: 16, bold: true };
    titleCell.alignment = { horizontal: "center" };

    // Summary info
    worksheet.getCell("A2").value = "Client Name:";
    worksheet.getCell("B2").value = client.name;
    worksheet.getCell("B2").font = { bold: true };

    worksheet.getCell("A3").value = "Month:";
    worksheet.getCell("B3").value = month;
    worksheet.getCell("B3").font = { bold: true };

    worksheet.getCell("A4").value = "Total Rides:";
    worksheet.getCell("B4").value = totals.totalRides;
    worksheet.getCell("B4").font = { bold: true };

    worksheet.getCell("A5").value = "Total Earnings:";
    worksheet.getCell("B5").value = `$${Number(totals.totalEarnings || 0).toFixed(2)}`;
    worksheet.getCell("B5").font = { bold: true };

    worksheet.getCell("A6").value = "Total GST:";
    worksheet.getCell("B6").value = `$${Number(totals.totalGST || 0).toFixed(2)}`;
    worksheet.getCell("B6").font = { bold: true };

    // Headers row (row 8)
    const headerRow = worksheet.getRow(8);
    headerRow.values = [
      "Date",
      "Time",
      "Start Time",
      "End Time",
      "Passengers",
      "From",
      "To",
      "Half Fare",
      "Fare Per Person",
      "GST",
      "Driver Name",
      "Driver Notes",
    ];
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFD3D3D3" },
    };
    headerRow.alignment = { horizontal: "center", vertical: "middle" };

    // Data rows
    rideRows.forEach((row, index) => {
      const dataRow = worksheet.getRow(9 + index);
      dataRow.values = [
        row.date,
        row.time,
        fmtCsv(row.startedAt),
        fmtCsv(row.droppedAt),
        row.passengers,
        row.from,
        row.to,
        `$${row.fullFare.toFixed(2)}`,
        `$${row.farePerPerson.toFixed(2)}`,
        `$${row.gst.toFixed(2)}`,
        row.driverName,
        row.driverNotes,
      ];
    });

    // Set response headers
    const filename = `client-trips-${client.name.replace(/[^a-zA-Z0-9]/g, "_")}-${month}.xlsx`;
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

    // Write to response
    await workbook.xlsx.write(res);
    res.end();
  } catch (e) {
    next(e);
  }
}

/**
 * Helper function to generate Excel for driver earnings
 */
async function generateDriverExcel(driverId, month, driver, totals, rideRows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Driver Earnings Report");

  // Set column widths
  worksheet.columns = [
    { width: 12 }, // Date
    { width: 10 }, // Time
    { width: 18 }, // Start Time
    { width: 18 }, // End Time
    { width: 20 }, // Passengers
    { width: 20 }, // From
    { width: 20 }, // To
    { width: 12 }, // Half Fare
    { width: 15 }, // Fare Per Person
    { width: 10 }, // GST
    { width: 25 }, // Driver Notes
  ];

  // Title row
  worksheet.mergeCells("A1:K1");
  const titleCell = worksheet.getCell("A1");
  titleCell.value = "Driver Earnings Report";
  titleCell.font = { size: 16, bold: true };
  titleCell.alignment = { horizontal: "center" };

  // Summary info
  worksheet.getCell("A2").value = "Driver Name:";
  worksheet.getCell("B2").value = driver.fullName;
  worksheet.getCell("B2").font = { bold: true };

  worksheet.getCell("A3").value = "Month:";
  worksheet.getCell("B3").value = month;
  worksheet.getCell("B3").font = { bold: true };

  worksheet.getCell("A4").value = "Total Rides:";
  worksheet.getCell("B4").value = totals.totalRides;
  worksheet.getCell("B4").font = { bold: true };

  worksheet.getCell("A5").value = "Total Earnings:";
  worksheet.getCell("B5").value = `$${Number(totals.totalEarnings || 0).toFixed(2)}`;
  worksheet.getCell("B5").font = { bold: true };

  worksheet.getCell("A6").value = "Total GST:";
  worksheet.getCell("B6").value = `$${Number(totals.totalGST || 0).toFixed(2)}`;
  worksheet.getCell("B6").font = { bold: true };

  // Headers row (row 8)
  const headerRow = worksheet.getRow(8);
  headerRow.values = [
    "Date",
    "Time",
    "Start Time",
    "End Time",
    "Passengers",
    "From",
    "To",
    "Half Fare",
    "Fare Per Person",
    "GST",
    "Driver Notes",
  ];
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD3D3D3" },
  };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };

  // Data rows
  rideRows.forEach((row, index) => {
    const dataRow = worksheet.getRow(9 + index);
    dataRow.values = [
      row.date,
      row.time,
      fmtCsv(row.startedAt),
      fmtCsv(row.droppedAt),
      row.passengers,
      row.from,
      row.to,
      `$${row.fullFare.toFixed(2)}`,
      `$${row.farePerPerson.toFixed(2)}`,
      `$${row.gst.toFixed(2)}`,
      row.driverNotes,
    ];
  });

  return workbook;
}

/**
 * Helper function to generate Excel for monthly report
 */
async function generateMonthlyExcel(month, totals, rideRows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Monthly Report");

  // Set column widths
  worksheet.columns = [
    { width: 12 }, // Date
    { width: 10 }, // Time
    { width: 18 }, // Start Time
    { width: 18 }, // End Time
    { width: 20 }, // Passengers
    { width: 20 }, // From
    { width: 20 }, // To
    { width: 12 }, // Half Fare
    { width: 15 }, // Fare Per Person
    { width: 10 }, // GST
    { width: 20 }, // Driver Name
    { width: 25 }, // Driver Notes
  ];

  // Title row
  worksheet.mergeCells("A1:L1");
  const titleCell = worksheet.getCell("A1");
  titleCell.value = "Monthly Report - All Drivers";
  titleCell.font = { size: 16, bold: true };
  titleCell.alignment = { horizontal: "center" };

  // Summary info
  worksheet.getCell("A2").value = "Month:";
  worksheet.getCell("B2").value = month;
  worksheet.getCell("B2").font = { bold: true };

  worksheet.getCell("A3").value = "Total Rides:";
  worksheet.getCell("B3").value = totals.totalRides;
  worksheet.getCell("B3").font = { bold: true };

  worksheet.getCell("A4").value = "Total Earnings:";
  worksheet.getCell("B4").value = `$${Number(totals.totalEarnings || 0).toFixed(2)}`;
  worksheet.getCell("B4").font = { bold: true };

  worksheet.getCell("A5").value = "Total GST:";
  worksheet.getCell("B5").value = `$${Number(totals.totalGST || 0).toFixed(2)}`;
  worksheet.getCell("B5").font = { bold: true };

  // Headers row (row 7)
  const headerRow = worksheet.getRow(7);
  headerRow.values = [
    "Date",
    "Time",
    "Start Time",
    "End Time",
    "Passengers",
    "From",
    "To",
    "Half Fare",
    "Fare Per Person",
    "GST",
    "Driver Name",
    "Driver Notes",
  ];
  headerRow.font = { bold: true };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD3D3D3" },
  };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };

  // Data rows
  rideRows.forEach((row, index) => {
    const dataRow = worksheet.getRow(8 + index);
    dataRow.values = [
      row.date,
      row.time,
      fmtCsv(row.startedAt),
      fmtCsv(row.droppedAt),
      row.passengers,
      row.from,
      row.to,
      `$${row.fullFare.toFixed(2)}`,
      `$${row.farePerPerson.toFixed(2)}`,
      `$${row.gst.toFixed(2)}`,
      row.driverName,
      row.driverNotes,
    ];
  });

  return workbook;
}

module.exports = {
  getDriverEarnings,
  downloadDriverEarnings,
  downloadDriverEarningsExcel,
  getMonthlyReport,
  downloadMonthlyReport,
  downloadMonthlyReportExcel,
  getClientTrips,
  downloadClientTrips,
};
