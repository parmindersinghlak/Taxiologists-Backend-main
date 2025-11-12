// server/src/models/Client.js
const mongoose = require("mongoose");

const clientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, trim: true }, // now optional
    email: { type: String, trim: true, lowercase: true },
    address: { type: String, trim: true },

    // NEW optional fields
    mptpCardNumber: { type: String, trim: true },
    planManager: { type: String, trim: true },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isDriverAdded: { type: Boolean, default: false },
  },
  { timestamps: true }
);

// helpful indexes
clientSchema.index({ name: 1, phone: 1 });
clientSchema.index({ mptpCardNumber: 1 }, { sparse: true });

module.exports = mongoose.model("Client", clientSchema);
