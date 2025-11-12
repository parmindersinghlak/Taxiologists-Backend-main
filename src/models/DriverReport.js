// src/models/DriverReport.js
const mongoose = require("mongoose");

const driverReportSchema = new mongoose.Schema(
  {
    reportId: { 
      type: String, 
      unique: true, 
      index: true,
      default: function() {
        // Generate unique report ID: DR-YYYYMMDD-XXXX
        const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const random = Math.random().toString(36).substring(2, 6).toUpperCase();
        return `DR-${date}-${random}`;
      }
    },

    // NEW: link report to a Shift (not required for legacy data, but set for new flow)
    shift: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Shift",
      index: true
    },

    // NEW: normalized report day "YYYY-MM-DD" to speed up queries / duplicate checks
    reportDay: {
      type: String,
      index: true,
      trim: true,
    },

    driver: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true,
      index: true 
    },
    date: { 
      type: Date, 
      required: true, 
      index: true 
    },
    taxiNumber: { 
      type: String, 
      required: true,
      trim: true 
    },

    // Meter readings with photo proof (mandatory)
    shiftStartTotal: {
      amount: { 
        type: Number, 
        required: true, 
        min: 0,
        validate: {
          validator: function(v) {
            return v >= 0;
          },
          message: 'Shift start total must be non-negative'
        }
      },
      photoUrl: { 
        type: String,
        trim: true,
        validate: {
          validator: function(v) {
            // Photo required only for submitted reports
            if (this.status === 'submitted' || this.status === 'approved') {
              return v && v.length > 0;
            }
            return true; // Allow drafts without photos
          },
          message: 'Shift start photo is required for submitted reports'
        }
      }
    },
    shiftEndTotal: {
      amount: { 
        type: Number, 
        required: true, 
        min: 0,
        validate: {
          validator: function(v) {
            return v >= this.shiftStartTotal?.amount || 0;
          },
          message: 'Shift end total must be greater than or equal to shift start total'
        }
      },
      photoUrl: { 
        type: String,
        trim: true,
        validate: {
          validator: function(v) {
            // Photo required only for submitted reports
            if (this.status === 'submitted' || this.status === 'approved') {
              return v && v.length > 0;
            }
            return true; // Allow drafts without photos
          },
          message: 'Shift end photo is required for submitted reports'
        }
      }
    },

    // Financial inputs
    liftings: { 
      type: Number, 
      default: 0, 
      min: 0 
    },
    cashFares: { 
      type: Number, 
      default: 0, 
      min: 0 
    },
    totalEFTPOS: {
      amount: { 
        type: Number, 
        default: 0, 
        min: 0 
      },
      photoUrl: { 
        type: String,
        validate: {
          validator: function(v) {
            // Photo required if amount > 0
            if (this.totalEFTPOS.amount > 0) {
              return v && v.length > 0;
            }
            return true;
          },
          message: 'EFTPOS photo is required when amount is greater than $0'
        }
      }
    },
    totalAccountTrips: { 
      type: Number, 
      default: 0, 
      min: 0 
    },
    cashExpenses: {
      amount: { 
        type: Number, 
        default: 0, 
        min: 0 
      },
      photoUrl: { 
        type: String,
        validate: {
          validator: function(v) {
            // Photo required if amount > 0
            if (this.cashExpenses.amount > 0) {
              return v && v.length > 0;
            }
            return true;
          },
          message: 'Expense photo is required when amount is greater than $0'
        }
      }
    },
    totalTripsCount: { 
      type: Number, 
      required: true, 
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: 'Total trips count must be a whole number'
      }
    },

    // Auto-calculated fields (calculated by service)
    calculations: {
      shiftTotalFares: { type: Number, default: 0 },
      totalFareAndLiftings: { type: Number, default: 0 },
      rentals: { type: Number, default: 0 },
      subTotal: { type: Number, default: 0 },
      tripLevy: { type: Number, default: 0 },
      driverNetPay: { type: Number, default: 0 },
      operatorEarnings: { type: Number, default: 0 },
      rentalRateUsed: { type: Number, default: 45 } // Store the rate used for calculation
    },

    // Status management
    status: {
      type: String,
      enum: ["draft", "submitted", "approved", "rejected", "archived"],
      default: "draft",
      index: true
    },

    // Admin review fields
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    reviewedAt: {
      type: Date
    },
    reviewNotes: {
      type: String,
      trim: true
    },
    rejectionReason: {
      type: String,
      trim: true
    },

    // Associated rides for reference and validation
    associatedRides: [{ 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "Ride" 
    }],

    // Additional metadata
    notes: {
      type: String,
      trim: true,
      maxlength: 1000
    },
    
    // Submission timestamp
    submittedAt: {
      type: Date
    }
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Indexes for efficient queries
driverReportSchema.index({ driver: 1, date: -1 });
driverReportSchema.index({ status: 1, submittedAt: -1 });
driverReportSchema.index({ date: 1, status: 1 });
// Helpful for duplicate-by-day checks without enforcing uniqueness (avoid migration issues)
driverReportSchema.index({ driver: 1, reportDay: 1 });

// Virtual for formatted report ID
driverReportSchema.virtual('formattedReportId').get(function() {
  const date = new Date(this.date);
  const dateStr = date.toISOString().split('T')[0].replace(/-/g, '');
  return `DR-${dateStr}-${this.reportId.slice(-4).toUpperCase()}`;
});

// Pre-validate: normalize reportDay from date
driverReportSchema.pre('validate', function(next) {
  if (this.date && !this.reportDay) {
    const d = new Date(this.date);
    if (!isNaN(d.getTime())) {
      this.reportDay = d.toISOString().slice(0, 10);
    }
  }
  next();
});

// Pre-save middleware to generate reportId if not provided
driverReportSchema.pre('save', function(next) {
  if (this.isNew && !this.reportId) {
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    this.reportId = `${timestamp}-${randomSuffix}`;
  }
  next();
});

// Pre-save middleware to update submittedAt when status changes to submitted
driverReportSchema.pre('save', function(next) {
  if (this.isModified('status') && this.status === 'submitted' && !this.submittedAt) {
    this.submittedAt = new Date();
  }
  next();
});

// Static method to get reports by driver and date range
driverReportSchema.statics.findByDriverAndDateRange = function(driverId, startDate, endDate) {
  return this.find({
    driver: driverId,
    date: {
      $gte: startDate,
      $lte: endDate
    }
  }).populate('driver', 'fullName username')
    .populate('reviewedBy', 'fullName')
    .sort({ date: -1 });
};

// Static method to get pending reports for admin
driverReportSchema.statics.findPendingReports = function() {
  return this.find({
    status: 'submitted'
  }).populate('driver', 'fullName username phone')
    .sort({ submittedAt: 1 });
};

// Method to check if report can be edited
driverReportSchema.methods.canEdit = function() {
  return this.status === 'draft';
};

// Method to check if report can be submitted
driverReportSchema.methods.canSubmit = function() {
  // Start meter photo is captured during shift start, not required for submission validation
  // Only validate end meter photo and conditional photos (EFTPOS, expenses)
  const hasEndMeterPhoto = !!this.shiftEndTotal.photoUrl;
  const needsEftposPhoto = (this.totalEFTPOS?.amount || 0) > 0;
  const hasEftposPhoto = !!this.totalEFTPOS?.photoUrl;
  const needsExpensePhoto = (this.cashExpenses?.amount || 0) > 0;
  const hasExpensePhoto = !!this.cashExpenses?.photoUrl;
  
  return this.status === 'draft' && 
         hasEndMeterPhoto &&
         (!needsEftposPhoto || hasEftposPhoto) &&
         (!needsExpensePhoto || hasExpensePhoto) &&
         this.totalTripsCount >= 0;
};

module.exports = mongoose.model("DriverReport", driverReportSchema);
