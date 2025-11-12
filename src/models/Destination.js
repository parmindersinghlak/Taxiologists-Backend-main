const mongoose = require("mongoose");

const destinationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    coordinates: {
      lat: { type: Number },
      lng: { type: Number },
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isDriverGenerated: { type: Boolean, default: false },
  },
  { timestamps: true }
);

destinationSchema.index({ name: 1 });
destinationSchema.index({ "coordinates.lat": 1, "coordinates.lng": 1 });

module.exports = mongoose.model("Destination", destinationSchema);
