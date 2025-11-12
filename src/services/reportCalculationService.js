// src/services/reportCalculationService.js
/**
 * Driver Report Calculation Service
 * Implements all business logic formulas for driver reports
 *
 * ✅ Supports Shift-based flow:
 * - `calculateReportTotals` accepts { allowPartial: true } to safely handle
 *   drafts that only have a shift start meter (no end meter yet).
 * - `canCalculateTotals(reportData)` tells controllers if inputs are complete.
 */

const {
  getDriverReportSettings: loadDriverReportSettings,
} = require("../services/driverReportSettingsService");

/**
 * Default calculation settings (fallbacks)
 */
const DEFAULT_SETTINGS = {
  rentalRatePercentage: 45,
  tripLevyRate: 1.32,
  gstRate: 10,
};

/**
 * Get current calculation settings from Settings store
 * Falls back to defaults if not found
 */
async function getCalculationSettings() {
  try {
    const s = await loadDriverReportSettings();
    return {
      rentalRatePercentage:
        typeof s?.rentalRatePercentage === "number"
          ? s.rentalRatePercentage
          : DEFAULT_SETTINGS.rentalRatePercentage,
      tripLevyRate:
        typeof s?.tripLevyRate === "number"
          ? s.tripLevyRate
          : DEFAULT_SETTINGS.tripLevyRate,
      gstRate:
        typeof s?.gstRate === "number" ? s.gstRate : DEFAULT_SETTINGS.gstRate,
    };
  } catch (error) {
    console.warn(
      "Failed to fetch calculation settings, using defaults:",
      error?.message || error
    );
    return DEFAULT_SETTINGS;
  }
}

/**
 * Determine if we have enough inputs to run full calculations
 * @param {Object} reportData
 * @returns {boolean}
 */
function canCalculateTotals(reportData) {
  if (!reportData) return false;
  const start = num(reportData.shiftStartTotal?.amount);
  const end = num(reportData.shiftEndTotal?.amount);
  // Need both numbers and end >= start
  return isFinite(start) && isFinite(end) && end >= start;
}

/**
 * Build a zeroed calculations object for partial/draft cases
 */
function zeroCalcs(settings, breakdownOverrides = {}) {
  return {
    shiftTotalFares: 0,
    totalFareAndLiftings: 0,
    rentals: 0,
    subTotal: 0,
    tripLevy: 0,
    driverNetPay: 0,
    operatorEarnings: 0,
    rentalRateUsed:
      settings?.rentalRatePercentage ?? DEFAULT_SETTINGS.rentalRatePercentage,
    calculatedAt: new Date(),
    partial: true,
    breakdown: {
      shiftStart: 0,
      shiftEnd: 0,
      shiftDifference: 0,
      liftings: 0,
      cashFares: 0,
      totalEFTPOS: 0,
      totalAccountTrips: 0,
      cashExpenses: 0,
      totalTripsCount: 0,
      rentalRate: `${
        settings?.rentalRatePercentage ?? DEFAULT_SETTINGS.rentalRatePercentage
      }%`,
      tripLevyRate: `$${
        settings?.tripLevyRate ?? DEFAULT_SETTINGS.tripLevyRate
      } per trip`,
      ...breakdownOverrides,
    },
  };
}

/**
 * Calculate all report totals based on the business formulas
 * @param {Object} reportData - The driver report input data
 * @param {Object|null} customSettings - Optional custom settings (for testing)
 * @param {Object} options - { allowPartial?: boolean } when true, returns zero-calcs if inputs incomplete
 * @returns {Object} Complete calculations object
 */
async function calculateReportTotals(
  reportData,
  customSettings = null,
  options = {}
) {
  const { allowPartial = false } = options;

  try {
    // Get current settings or use custom settings for testing
    const settings = customSettings || (await getCalculationSettings());

    // Validate input data
    if (!reportData || typeof reportData !== "object") {
      throw new Error("Invalid report data provided");
    }

    // Extract and validate numeric inputs
    const shiftStartTotal = num(reportData.shiftStartTotal?.amount);
    const shiftEndTotal = num(reportData.shiftEndTotal?.amount);
    const liftings = num(reportData.liftings);
    const cashFares = num(reportData.cashFares);
    const totalEFTPOS = num(reportData.totalEFTPOS?.amount);
    const totalAccountTrips = num(reportData.totalAccountTrips);
    const cashExpenses = num(reportData.cashExpenses?.amount);
    const totalTripsCount = int(reportData.totalTripsCount);

    // If we don't have enough to calculate (typical at shift start), either return partial zeros or throw
    if (!canCalculateTotals(reportData)) {
      if (allowPartial) {
        return zeroCalcs(settings, {
          shiftStart: shiftStartTotal,
          shiftEnd: shiftEndTotal,
          liftings,
          cashFares,
          totalEFTPOS,
          totalAccountTrips,
          cashExpenses,
          totalTripsCount,
        });
      }
      if (
        isFinite(shiftStartTotal) &&
        isFinite(shiftEndTotal) &&
        shiftEndTotal < shiftStartTotal
      ) {
        throw new Error(
          "Shift end total cannot be less than shift start total"
        );
      }
      throw new Error("Insufficient data to calculate totals");
    }

    // Business Logic Formulas

    // 1. shiftTotalFares = shiftEndTotal - shiftStartTotal
    const shiftTotalFares = shiftEndTotal - shiftStartTotal;

    // 2. totalFareAndLiftings = shiftTotalFares + liftings + cashFares
    const totalFareAndLiftings = shiftTotalFares + liftings + cashFares;

    // 3. rentals = (totalFareAndLiftings × rentalRatePercentage) ÷ 100
    const rentals =
      (totalFareAndLiftings * settings.rentalRatePercentage) / 100;

    // 4. subTotal = rentals - (totalEFTPOS + totalAccountTrips + cashExpenses)
    const subTotal = rentals - (totalEFTPOS + totalAccountTrips + cashExpenses);

    // 5. tripLevy = totalTripsCount × current trip levy rate
    const tripLevy = totalTripsCount * settings.tripLevyRate;

    // 6. driverNetPay = -(subTotal + tripLevy)
    const driverNetPay = -(subTotal + tripLevy);

    // 7. operatorEarnings = totalFareAndLiftings - rentals
    const operatorEarnings = totalFareAndLiftings - rentals;

    // Return complete calculations object
    return {
      shiftTotalFares: round2(shiftTotalFares),
      totalFareAndLiftings: round2(totalFareAndLiftings),
      rentals: round2(rentals),
      subTotal: round2(subTotal),
      tripLevy: round2(tripLevy),
      driverNetPay: round2(driverNetPay),
      operatorEarnings: round2(operatorEarnings),
      rentalRateUsed: settings.rentalRatePercentage,
      calculatedAt: new Date(),
      partial: false,
      // Additional breakdown for transparency
      breakdown: {
        shiftStart: shiftStartTotal,
        shiftEnd: shiftEndTotal,
        shiftDifference: shiftTotalFares,
        liftings,
        cashFares,
        totalEFTPOS,
        totalAccountTrips,
        cashExpenses,
        totalTripsCount,
        rentalRate: `${settings.rentalRatePercentage}%`,
        tripLevyRate: `$${settings.tripLevyRate} per trip`,
      },
    };
  } catch (error) {
    console.error("Calculation error:", error.message);
    throw new Error(`Failed to calculate report totals: ${error.message}`);
  }
}

/**
 * Validate report calculations
 * Performs sanity checks on the calculated values
 */
function validateCalculations(calculations, inputData) {
  const errors = [];

  if (calculations.shiftTotalFares < 0) {
    errors.push("Shift total fares cannot be negative");
  }

  if (calculations.totalFareAndLiftings < 0) {
    errors.push("Total fare and liftings cannot be negative");
  }

  if (calculations.rentals > calculations.totalFareAndLiftings) {
    errors.push("Rentals cannot exceed total fare and liftings");
  }

  if ((inputData.totalTripsCount ?? 0) < 0) {
    errors.push("Total trips count cannot be negative");
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Calculate real-time preview (for mobile app live updates)
 * Simplified; accepts optional settings to keep trip levy & rental rate dynamic
 */
function calculateRealtimePreview(
  reportData,
  settings = {
    rentalRatePercentage: DEFAULT_SETTINGS.rentalRatePercentage,
    tripLevyRate: DEFAULT_SETTINGS.tripLevyRate,
  }
) {
  try {
    const shiftStartTotal = num(reportData.shiftStartTotal);
    const shiftEndTotal = num(reportData.shiftEndTotal);
    const liftings = num(reportData.liftings);
    const cashFares = num(reportData.cashFares);
    const totalEFTPOS = num(reportData.totalEFTPOS);
    const totalAccountTrips = num(reportData.totalAccountTrips);
    const cashExpenses = num(reportData.cashExpenses);
    const totalTripsCount = int(reportData.totalTripsCount);

    const rate =
      typeof settings?.rentalRatePercentage === "number"
        ? settings.rentalRatePercentage
        : DEFAULT_SETTINGS.rentalRatePercentage;
    const levy =
      typeof settings?.tripLevyRate === "number"
        ? settings.tripLevyRate
        : DEFAULT_SETTINGS.tripLevyRate;

    const shiftTotalFares = Math.max(0, shiftEndTotal - shiftStartTotal);
    const totalFareAndLiftings = shiftTotalFares + liftings + cashFares;
    const rentals = (totalFareAndLiftings * rate) / 100;
    const subTotal = rentals - (totalEFTPOS + totalAccountTrips + cashExpenses);
    const tripLevy = totalTripsCount * levy;
    const driverNetPay = -(subTotal + tripLevy);
    const operatorEarnings = totalFareAndLiftings - rentals;

    return {
      shiftTotalFares: round2(shiftTotalFares),
      totalFareAndLiftings: round2(totalFareAndLiftings),
      rentals: round2(rentals),
      subTotal: round2(subTotal),
      tripLevy: round2(tripLevy),
      driverNetPay: round2(driverNetPay),
      operatorEarnings: round2(operatorEarnings),
    };
  } catch (error) {
    return {
      error: `Calculation error: ${error.message}`,
    };
  }
}

/**
 * Calculate expected vs actual reconciliation
 * Compare reported figures with system ride data
 */
async function calculateReconciliation(reportData, associatedRides) {
  try {
    if (!associatedRides || !Array.isArray(associatedRides)) {
      return {
        hasSystemData: false,
        message: "No system ride data available for comparison",
      };
    }

    const systemTotals = associatedRides.reduce(
      (acc, ride) => {
        if (ride.status === "completed") {
          acc.totalSystemFares += ride.fare?.total || 0;
          acc.totalSystemGST += ride.fare?.gst || 0;
          acc.totalSystemTrips += 1;
        }
        return acc;
      },
      {
        totalSystemFares: 0,
        totalSystemGST: 0,
        totalSystemTrips: 0,
      }
    );

    const reportedTotalFares =
      (reportData.shiftEndTotal?.amount || 0) -
      (reportData.shiftStartTotal?.amount || 0);
    const reportedTrips = reportData.totalTripsCount || 0;

    const fareVariance = reportedTotalFares - systemTotals.totalSystemFares;
    const tripVariance = reportedTrips - systemTotals.totalSystemTrips;

    return {
      hasSystemData: true,
      system: systemTotals,
      reported: {
        totalFares: reportedTotalFares,
        totalTrips: reportedTrips,
      },
      variances: {
        fareVariance: round2(fareVariance),
        tripVariance,
        fareVariancePercentage:
          systemTotals.totalSystemFares > 0
            ? round2((fareVariance / systemTotals.totalSystemFares) * 100)
            : 0,
      },
      flags: {
        significantFareVariance: Math.abs(fareVariance) > 50,
        significantTripVariance: Math.abs(tripVariance) > 2,
        requiresReview:
          Math.abs(fareVariance) > 100 || Math.abs(tripVariance) > 5,
      },
    };
  } catch (error) {
    console.error("Reconciliation calculation error:", error);
    return {
      hasSystemData: false,
      error: error.message,
    };
  }
}

/** ---------- Utilities ---------- */
function round2(number) {
  return Math.round((Number(number) + Number.EPSILON) * 100) / 100;
}
function num(v) {
  const n = parseFloat(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}
function int(v) {
  const n = parseInt(v ?? 0, 10);
  return Number.isFinite(n) ? n : 0;
}

/** ---------- Exports ---------- */
module.exports = {
  calculateReportTotals,
  validateCalculations,
  calculateRealtimePreview,
  calculateReconciliation,
  getCalculationSettings,
  canCalculateTotals,
  formatCurrency,
  DEFAULT_SETTINGS,
};

/**
 * Format currency for display (kept for convenience)
 */
function formatCurrency(amount) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  }).format(amount);
}
