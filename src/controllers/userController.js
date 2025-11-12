const User = require("../models/User");
const { ROLES, DRIVER_STATUS } = require("../utils/constants");

function forbidManagerCreatingAdmin(req) {
  return req.user.role === ROLES.MANAGER;
}

async function listUsers(req, res, next) {
  try {
    const { role, status, q } = req.query;
    const filter = {};
    if (role) filter.role = role;
    if (status) filter.status = status;
    if (q)
      filter.$or = [
        { username: new RegExp(q, "i") },
        { fullName: new RegExp(q, "i") },
        { email: new RegExp(q, "i") },
      ];
    const users = await User.find(filter).sort({ createdAt: -1 });
    res.json({ success: true, users });
  } catch (e) {
    next(e);
  }
}

async function createUser(req, res, next) {
  try {
    const {
      username,
      email,
      password,
      fullName,
      phone,
      role = ROLES.DRIVER,
      status = DRIVER_STATUS.FREE,
    } = req.body || {};
    if (!username || !email || !password || !fullName || !phone) {
      return res
        .status(400)
        .json({
          success: false,
          code: "VALIDATION_ERROR",
          message: "Missing required fields",
        });
    }
    if (forbidManagerCreatingAdmin(req) && role === ROLES.ADMIN) {
      return res
        .status(403)
        .json({
          success: false,
          code: "FORBIDDEN",
          message: "Managers cannot create admins",
        });
    }

    const exists = await User.findOne({ $or: [{ username }, { email }] });
    if (exists) {
      return res
        .status(409)
        .json({
          success: false,
          code: "DUPLICATE",
          message: "Username or email already exists",
        });
    }

    const doc = await User.create({
      username,
      email,
      password,
      fullName,
      phone,
      role,
      status: role === ROLES.DRIVER ? status : undefined,
      createdBy: req.user.id,
    });

    res.status(201).json({ success: true, user: doc.toJSON() });
  } catch (e) {
    next(e);
  }
}

async function getUser(req, res, next) {
  try {
    const user = await User.findById(req.params.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, code: "NOT_FOUND", message: "User not found" });
    res.json({ success: true, user });
  } catch (e) {
    next(e);
  }
}

async function updateUser(req, res, next) {
  try {
    // Prevent admin from editing themselves through user management
    if (req.params.id === req.user.id) {
      return res
        .status(403)
        .json({
          success: false,
          code: "FORBIDDEN",
          message: "Please use profile management to update your own details",
        });
    }

    const { role, status, fullName, phone, email } = req.body || {};
    const update = {};

    if (role) {
      // Only admin can change roles; managers cannot escalate anyone to admin
      if (req.user.role !== ROLES.ADMIN) {
        return res
          .status(403)
          .json({
            success: false,
            code: "FORBIDDEN",
            message: "Only admin can change roles",
          });
      }
      update.role = role;
    }

    if (status) update.status = status;
    if (fullName) update.fullName = fullName;
    if (phone) update.phone = phone;
    if (email) update.email = email;

    const user = await User.findByIdAndUpdate(req.params.id, update, {
      new: true,
    });
    if (!user)
      return res
        .status(404)
        .json({ success: false, code: "NOT_FOUND", message: "User not found" });

    res.json({ success: true, user });
  } catch (e) {
    next(e);
  }
}

async function deleteUser(req, res, next) {
  try {
    // Prevent admin from deleting themselves
    if (req.params.id === req.user.id) {
      return res
        .status(403)
        .json({
          success: false,
          code: "FORBIDDEN",
          message: "Cannot delete your own admin account",
        });
    }

    const user = await User.findByIdAndDelete(req.params.id);
    if (!user)
      return res
        .status(404)
        .json({ success: false, code: "NOT_FOUND", message: "User not found" });

    // Cascade delete: Remove all agreements for this driver
    const DriverAgreement = require('../models/DriverAgreement');
    const deletedAgreements = await DriverAgreement.deleteMany({ driver: req.params.id });

    res.json({ 
      success: true, 
      message: "User deleted successfully",
      deletedAgreements: deletedAgreements.deletedCount
    });
  } catch (e) {
    next(e);
  }
}

module.exports = { listUsers, createUser, getUser, updateUser, deleteUser };
