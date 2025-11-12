const mongoose = require('mongoose');

const DriverAgreementSchema = new mongoose.Schema({
  driver: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  submittedAt: { type: Date, default: Date.now },
  reviewedAt: Date,
  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  reviewNotes: String,

  personalInfo: {
    fullName: { type: String, required: true },
    driverId: { type: String, required: true },
    dateOfBirth: { type: Date, required: true },
    contactNumber: { type: String, required: true },
    email: { type: String, required: true },
    address: {
      street: { type: String, required: true },
      suburb: { type: String, required: true },
      state: { type: String, required: true },
      postCode: { type: String, required: true }
    },
    licenseNumber: { type: String, required: true },
    licenseExpiry: { type: Date, required: true },
    driverAccreditationNumber: { type: String, required: true },
    abn: String,
    gstRegistered: { type: Boolean, required: true },
    currentPoliceCheck: { type: Boolean }
  },

  // Photo URLs
  photos: {
    driverLicenseFront: { type: String, required: true },
    driverLicenseBack: { type: String, required: true },
    driverLicenseSelfie: { type: String, required: true },
    driverAccreditation: { type: String, required: true },
    policeCheck: { type: String }
  },

  // System
  ipAddress: String,
  userAgent: String,
  metadata: mongoose.Schema.Types.Mixed // e.g., { agreementVersion: '1.0' }
}, { timestamps: true });

DriverAgreementSchema.index({ driver: 1, status: 1 });
DriverAgreementSchema.index({ status: 1, submittedAt: 1 });

module.exports = mongoose.model('DriverAgreement', DriverAgreementSchema);