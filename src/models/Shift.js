// src/models/Shift.js
const mongoose = require('mongoose');

const shiftSchema = new mongoose.Schema(
  {
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    taxiNumber: {
      type: String,
      required: true,
      trim: true,
    },
    startMeter: {
      type: Number,
      required: true,
      min: 0,
    },
    startMeterPhoto: {
      type: String,
      required: true,
      trim: true,
    },
    startTime: {
      type: Date,
      default: Date.now,
      index: true,
    },
    endTime: {
      type: Date,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true }
);

// one active shift per driver
shiftSchema.index({ driver: 1, isActive: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

module.exports = mongoose.model('Shift', shiftSchema);
