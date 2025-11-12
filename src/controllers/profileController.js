const User = require("../models/User");
const bcrypt = require("bcryptjs");

async function getProfile(req, res, next) {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, code: "NOT_FOUND", message: "User not found" });
    }
    res.json({ success: true, user });
  } catch (e) {
    next(e);
  }
}

async function updateProfile(req, res, next) {
  try {
    const { username, fullName, email, currentPassword, newPassword } = req.body || {};
    const update = {};

    // Get current user
    const user = await User.findById(req.user.id);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, code: "NOT_FOUND", message: "User not found" });
    }

    // If changing password, verify current password
    if (newPassword) {
      if (!currentPassword) {
        return res
          .status(400)
          .json({
            success: false,
            code: "VALIDATION_ERROR",
            message: "Current password is required to set new password",
          });
      }

      const isValid = await user.comparePassword(currentPassword);
      if (!isValid) {
        return res
          .status(400)
          .json({
            success: false,
            code: "INVALID_PASSWORD",
            message: "Current password is incorrect",
          });
      }

      // Hash new password
      const salt = await bcrypt.genSalt(10);
      update.password = await bcrypt.hash(newPassword, salt);
    }

    if (username) {
      const existingUser = await User.findOne({
        username,
        _id: { $ne: req.user.id },
      });
      if (existingUser) {
        return res
          .status(409)
          .json({
            success: false,
            code: "DUPLICATE",
            message: "Username already exists",
          });
      }
      update.username = username;
    }

    if (email) {
      const existingUser = await User.findOne({
        email,
        _id: { $ne: req.user.id },
      });
      if (existingUser) {
        return res
          .status(409)
          .json({
            success: false,
            code: "DUPLICATE",
            message: "Email already exists",
          });
      }
      update.email = email;
    }

    if (fullName) update.fullName = fullName;

    const updatedUser = await User.findByIdAndUpdate(req.user.id, update, {
      new: true,
    });

    res.json({ success: true, user: updatedUser });
  } catch (e) {
    next(e);
  }
}

module.exports = { getProfile, updateProfile };
